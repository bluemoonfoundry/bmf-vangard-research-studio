import { describe, expect, it } from 'vitest';
import type { Bible, Fact, TreeItem } from '@/project/types';
import { emptyExtraction, type Canon } from '@/extraction/types';
import { fingerprint } from '@/extraction/apply';
import { pairFingerprint } from '@/extraction/conflictCheck';
import { findContradictions } from '@/bible/contradictions';
import { renameAttribute, renameCheck, renamedPins, renameCounts } from '@/bible/rename';

let n = 0;
const fact = (entityId: string, attribute: string, value: Fact['value'] = 'x', over: Partial<Fact> = {}): Fact => ({
  id: `f${++n}`, entityId, attribute, value, status: 'kept', origin: 'manual', createdAt: 'T0', updatedAt: 'T0', ...over,
});
const bibleOf = (facts: Fact[]): Bible => ({ facts, dependencies: [], decisions: [] });
const canonOf = (facts: Fact[]): Canon => ({ bible: bibleOf(facts), extraction: emptyExtraction() });
const ent = (id: string, cardFacts?: string[]): TreeItem =>
  ({ id, parentId: null, type: 'entity', entityKind: 'character', title: id, order: 0, keywords: [], ...(cardFacts && { cardFacts }) });

describe('renameAttribute', () => {
  it('renames on one entity only, stamping updatedAt', () => {
    const canon = canonOf([fact('mara', 'Eyes', 'green'), fact('ivo', 'eyes', 'brown'), fact('mara', 'hair', 'red')]);
    const next = renameAttribute(canon, { from: 'eyes', to: ' Eye colour ', entityIds: new Set(['mara']) }, 'T1');
    expect(next.bible.facts.map(f => [f.entityId, f.attribute, f.updatedAt])).toEqual([
      ['mara', 'Eye colour', 'T1'], ['ivo', 'eyes', 'T0'], ['mara', 'hair', 'T0'],
    ]);
  });

  it('renames on every entity when no scope is given', () => {
    const next = renameAttribute(canonOf([fact('mara', 'Eyes'), fact('ivo', 'eyes ')]), { from: 'EYES', to: 'eye colour', entityIds: null }, 'T1');
    expect(next.bible.facts.map(f => f.attribute)).toEqual(['eye colour', 'eye colour']);
  });

  it('merging into an existing attribute brings differing values into one contradiction', () => {
    const canon = canonOf([fact('mara', 'eyes', 'green'), fact('mara', 'eye colour', 'brown')]);
    expect(findContradictions(canon.bible, new Set(['mara']))).toEqual([]);
    const next = renameAttribute(canon, { from: 'eyes', to: 'eye colour', entityIds: null }, 'T1');
    expect(findContradictions(next.bible, new Set(['mara']))).toHaveLength(1);
  });

  it('renames decisions in scope', () => {
    const canon = canonOf([fact('mara', 'eyes')]);
    canon.bible.decisions = [
      { id: 'd1', entityId: 'mara', attribute: 'Eyes', kind: 'kept_all', factIds: [], setAsideIds: [], at: 'T' },
      { id: 'd2', entityId: 'ivo', attribute: 'eyes', kind: 'kept_all', factIds: [], setAsideIds: [], at: 'T' },
    ];
    const next = renameAttribute(canon, { from: 'eyes', to: 'eye colour', entityIds: new Set(['mara']) }, 'T1');
    expect(next.bible.decisions.map(d => d.attribute)).toEqual(['eye colour', 'eyes']);
  });

  it('renames pending proposals and keeps rejections, flags and dismissals matching', () => {
    const mara = fact('mara', 'eyes', 'green');
    const age = fact('mara', 'age', '24');
    const canon: Canon = {
      bible: bibleOf([mara, age]),
      extraction: {
        ...emptyExtraction(),
        pending: [
          { id: 'p1', ref: { entityId: 'mara' }, attribute: 'Eyes', value: 'grey', strength: 'suggested', evidence: [], createdAt: 'T' },
          { id: 'p2', ref: { cardId: 'c1' }, attribute: 'eyes', value: 'grey', strength: 'suggested', evidence: [], createdAt: 'T' },
        ],
        rejections: [{ fingerprint: fingerprint('mara', 'eyes', 'blue'), label: 'eyes: blue', at: 'T' }],
        dismissedFlags: [{ fingerprint: pairFingerprint(mara, age), label: 'x', at: 'T' }],
        flags: [{ id: 'fl', factIds: [mara.id, age.id], reason: 'r', fingerprint: pairFingerprint(mara, age), at: 'T' }],
      },
    };
    const next = renameAttribute(canon, { from: 'eyes', to: 'Eye colour', entityIds: new Set(['mara']) }, 'T1');
    expect(next.extraction.pending.map(p => p.attribute)).toEqual(['Eye colour', 'eyes']);
    expect(next.extraction.rejections[0].fingerprint).toBe(fingerprint('mara', 'eye colour', 'blue'));
    const renamed = next.bible.facts.find(f => f.id === mara.id)!;
    const ageAfter = next.bible.facts.find(f => f.id === age.id)!;
    expect(next.extraction.dismissedFlags![0].fingerprint).toBe(pairFingerprint(renamed, ageAfter));
    expect(next.extraction.flags![0].fingerprint).toBe(pairFingerprint(renamed, ageAfter));
  });

  it('renames pending proposals for new cards only when renaming everywhere', () => {
    const canon: Canon = {
      bible: bibleOf([]),
      extraction: {
        ...emptyExtraction(),
        pending: [{ id: 'p2', ref: { cardId: 'c1' }, attribute: 'eyes', value: 'grey', strength: 'suggested', evidence: [], createdAt: 'T' }],
      },
    };
    expect(renameAttribute(canon, { from: 'eyes', to: 'eye colour', entityIds: null }, 'T1').extraction.pending[0].attribute).toBe('eye colour');
  });

  it('returns the same canon when nothing matches', () => {
    const canon = canonOf([fact('mara', 'hair')]);
    expect(renameAttribute(canon, { from: 'eyes', to: 'eye colour', entityIds: null }, 'T1')).toBe(canon);
  });
});

describe('renameCheck', () => {
  const bible = bibleOf([fact('mara', 'eyes'), fact('mara', 'age', { age: 6, year: 0 }), fact('ivo', 'age', '60'), fact('ev', 'when', { season: 1 })]);

  it('needs a new name', () => {
    expect(renameCheck(bible, 'eyes', '  ', null)).toBe('Enter a new name.');
    expect(renameCheck(bible, 'eyes', 'EYES', null)).toBeNull(); // a change of spelling is allowed
    expect(renameCheck(bible, 'eyes', 'eye colour', null)).toBeNull();
  });

  it('keeps story positions under "when"', () => {
    expect(renameCheck(bible, 'when', 'date', null)).toBe('"when" holds story positions and can\'t be renamed.');
    expect(renameCheck(bible, 'eyes', 'When', null)).toBe('"when" holds story positions; choose another name.');
  });

  it('keeps ages with a year under "age"', () => {
    expect(renameCheck(bible, 'age', 'years', new Set(['mara']))).toBe('Ages with a year must stay under "age".');
    expect(renameCheck(bible, 'age', 'years', new Set(['ivo']))).toBeNull();
    expect(renameCheck(bible, 'age', 'years', null)).toBe('Ages with a year must stay under "age".');
    expect(renameCheck(bible, 'eyes', 'Age', null)).toBeNull();
  });
});

describe('renameCounts', () => {
  it('counts facts and entities for one entity and everywhere', () => {
    const bible = bibleOf([fact('mara', 'Eyes'), fact('mara', 'eyes', 'y'), fact('ivo', 'eyes'), fact('ivo', 'hair')]);
    expect(renameCounts(bible, 'eyes', new Set(['mara']))).toEqual({ facts: 2, entities: 1 });
    expect(renameCounts(bible, 'eyes', null)).toEqual({ facts: 3, entities: 2 });
  });
});

describe('renamedPins', () => {
  it('renames a pinned key in scope, keeping its place and dropping a duplicate', () => {
    const items = [ent('mara', ['role', 'eyes', 'eye colour']), ent('ivo', ['eyes']), ent('ash'), ent('lin', ['hair'])];
    expect(renamedPins(items, 'Eyes', 'Eye Colour', null)).toEqual([
      { id: 'mara', cardFacts: ['role', 'eye colour'] },
      { id: 'ivo', cardFacts: ['eye colour'] },
    ]);
    expect(renamedPins(items, 'eyes', 'eye colour', new Set(['ivo']))).toEqual([{ id: 'ivo', cardFacts: ['eye colour'] }]);
  });
});
