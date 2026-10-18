import { describe, it, expect } from 'vitest';
import type { Bible, Fact, TreeItem } from '@/project/types';
import { emptyExtraction, type ConflictFlag, type ExtractionState } from '@/extraction/types';
import {
  applyConflictCheck, buildConflictRequest, checkFacts, CONFLICT_SYSTEM, dismissFlag, estimateCheck,
  flagCounts, liveFlags, MAX_CHECK_FACTS, pairFingerprint,
} from '@/extraction/conflictCheck';
import { pruneExtraction } from '@/extraction/prune';

const NOW = '2026-10-18T12:00:00.000Z';
const entity = (id: string, title: string, entityKind = 'character'): TreeItem =>
  ({ id, type: 'entity', title, parentId: null, entityKind } as TreeItem);
const fact = (id: string, entityId: string, attribute: string, value: Fact['value'], status: Fact['status'] = 'kept'): Fact =>
  ({ id, entityId, attribute, value, status, origin: 'manual', createdAt: NOW, updatedAt: NOW });
const bibleOf = (...facts: Fact[]): Bible => ({ facts, dependencies: [], decisions: [] });

const MARA = entity('mara', 'Mara');
const IVO = entity('ivo', 'Ivo');
const items = [MARA, IVO];
const age = fact('f-age', 'mara', 'age', '24');
const born = fact('f-born', 'mara', 'born', '40 years before the story');
const eyes = fact('f-eyes', 'mara', 'eyes', 'green', 'proposed');
const aside = fact('f-aside', 'mara', 'hair', 'red', 'set_aside');
const ivoAge = fact('f-ivo', 'ivo', 'age', '60');

let n = 0;
const newId = () => `flag-${++n}`;

describe('checkFacts', () => {
  it('takes the live facts of the scope, kept before proposed', () => {
    const bible = bibleOf(eyes, age, aside, born, ivoAge);
    const { facts, total } = checkFacts(bible, ['mara']);
    expect(facts.map(f => f.id)).toEqual(['f-age', 'f-born', 'f-eyes']);
    expect(total).toBe(3);
  });

  it('caps the facts sent', () => {
    const many = Array.from({ length: MAX_CHECK_FACTS + 5 }, (_, i) => fact(`f${i}`, 'mara', `a${i}`, String(i)));
    const { facts, total } = checkFacts(bibleOf(...many), ['mara']);
    expect(facts).toHaveLength(MAX_CHECK_FACTS);
    expect(total).toBe(MAX_CHECK_FACTS + 5);
  });
});

describe('buildConflictRequest', () => {
  it('names each fact by a short ref under its entity and maps the refs back', () => {
    const { request, refs } = buildConflictRequest({ provider: 'gemini', model: 'm', items, facts: [age, born, ivoAge] });
    expect(request).toMatchObject({ provider: 'gemini', model: 'm', system: CONFLICT_SYSTEM });
    expect(request.text).toContain('## Mara (character)');
    expect(request.text).toContain('- F1 [kept] age: 24');
    expect(request.text).toContain('- F2 [kept] born: 40 years before the story');
    expect(request.text).toContain('## Ivo (character)\n- F3 [kept] age: 60');
    expect(refs).toEqual({ F1: 'f-age', F2: 'f-born', F3: 'f-ivo' });
  });

  it('writes a story position as text', () => {
    const when = fact('f-when', 'mara', 'when', { season: 2, episode: 3 });
    expect(buildConflictRequest({ provider: 'gemini', model: 'm', items, facts: [when] }).request.text).toContain('when: S2 · E3');
  });
});

describe('applyConflictCheck', () => {
  const bible = bibleOf(age, born, eyes, ivoAge);
  const refs = { F1: 'f-age', F2: 'f-born', F3: 'f-eyes', F4: 'f-ivo' };
  const checked = ['f-age', 'f-born', 'f-eyes', 'f-ivo'];

  it('adds a flag per valid pair, skipping unknown refs, exact contradictions and duplicates', () => {
    const sameAttr = fact('f-age2', 'mara', 'Age', '30');
    const b = bibleOf(age, born, eyes, ivoAge, sameAttr);
    const { extraction, added } = applyConflictCheck({
      extraction: emptyExtraction(), bible: b, checkedFactIds: [...checked, 'f-age2'], refs: { ...refs, F5: 'f-age2' }, now: NOW, newId,
      conflicts: [
        { a: 'F1', b: 'F2', reason: 'Ages disagree.' },
        { a: 'F2', b: 'F1', reason: 'Same pair again.' },
        { a: 'F1', b: 'F9', reason: 'Unknown ref.' },
        { a: 'F1', b: 'F5', reason: 'Already an exact contradiction.' },
      ],
    });
    expect(added).toBe(1);
    expect(extraction.flags).toEqual([{
      id: expect.any(String), factIds: ['f-age', 'f-born'], reason: 'Ages disagree.', fingerprint: pairFingerprint(age, born), at: NOW,
    }]);
  });

  it('replaces earlier flags among the checked facts and keeps the rest', () => {
    const old: ConflictFlag = { id: 'old', factIds: ['f-age', 'f-eyes'], reason: 'r', fingerprint: pairFingerprint(age, eyes), at: NOW };
    const outside: ConflictFlag = { id: 'out', factIds: ['f-age', 'f-other'], reason: 'r', fingerprint: 'x', at: NOW };
    const { extraction } = applyConflictCheck({
      extraction: { ...emptyExtraction(), flags: [old, outside] }, bible, checkedFactIds: checked, refs, now: NOW, newId,
      conflicts: [],
    });
    expect(extraction.flags).toEqual([outside]);
  });

  it('never brings back a dismissed pair', () => {
    const x: ExtractionState = { ...emptyExtraction(), dismissedFlags: [{ fingerprint: pairFingerprint(born, age), label: 'l', at: NOW }] };
    const { extraction, added, dismissed } = applyConflictCheck({
      extraction: x, bible, checkedFactIds: checked, refs, now: NOW, newId, conflicts: [{ a: 'F1', b: 'F2', reason: 'Ages.' }],
    });
    expect(added).toBe(0);
    expect(dismissed).toBe(1);
    expect(extraction.flags ?? []).toEqual([]);
  });
});

describe('liveFlags, dismissFlag and pruning', () => {
  const flag: ConflictFlag = { id: 'g1', factIds: ['f-age', 'f-born'], reason: 'Ages disagree.', fingerprint: pairFingerprint(age, born), at: NOW };
  const x: ExtractionState = { ...emptyExtraction(), flags: [flag] };

  it('shows a flag while both facts are live and unchanged', () => {
    expect(liveFlags(bibleOf(age, born), x).map(f => f.flag.id)).toEqual(['g1']);
    expect(liveFlags(bibleOf(age, born), x, 'ivo')).toEqual([]);
    expect(liveFlags(bibleOf(age, born), x)[0].facts.map(f => f.id)).toEqual(['f-age', 'f-born']);
    expect(liveFlags(bibleOf(age, { ...born, status: 'set_aside' }), x)).toEqual([]);
    expect(liveFlags(bibleOf(age, { ...born, value: '24 years before' }), x)).toEqual([]);
    expect(liveFlags(bibleOf(age), x)).toEqual([]);
  });

  it('counts live flags per entity', () => {
    expect(flagCounts(bibleOf(age, born), x)).toEqual(new Map([['mara', 1]]));
  });

  it('dismissing is sticky and removes the flag', () => {
    const next = dismissFlag(x, flag, bibleOf(age, born), NOW);
    expect(next.flags).toEqual([]);
    expect(next.dismissedFlags).toEqual([{ fingerprint: flag.fingerprint, label: 'age: 24 / born: 40 years before the story', at: NOW }]);
    expect(liveFlags(bibleOf(age, born), { ...next, flags: [flag] })).toEqual([]);
  });

  it('save pruning drops flags whose facts are gone', () => {
    expect(pruneExtraction(x, items, bibleOf(age, born))).toBe(x);
    expect(pruneExtraction(x, items, bibleOf(age)).flags).toEqual([]);
  });
});

describe('estimateCheck', () => {
  it('reports facts sent, facts in scope and approximate tokens', () => {
    const e = estimateCheck(items, bibleOf(age, born), ['mara']);
    expect(e).toMatchObject({ facts: 2, total: 2 });
    expect(e.tokens).toBeGreaterThan(0);
  });
});
