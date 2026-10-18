import { describe, expect, it } from 'vitest';
import type { Bible, Evidence, Fact, TreeItem } from '@/project/types';
import { emptyBible } from '@/bible/normalize';
import { emptyExtraction, type Canon, type ExtractionState, type PendingProposal } from '@/extraction/types';
import { cardFingerprint, fingerprint, rejectedFingerprints } from '@/extraction/apply';
import {
  approveCard, dismiss, liftRejection, promote, pruneExtraction, rejectCard, rejectionsFor, reviewCount, reviewGroups,
} from '@/extraction/review';

const ent = (id: string, title: string): TreeItem => ({ id, parentId: null, type: 'entity', entityKind: 'character', title, order: 0, keywords: [] });
const src = (start: number) => ({ itemId: 's1', quote: 'q', start, end: start + 1 });
const ev = (start: number, strength: Evidence['strength'] = 'said'): Evidence => ({ source: src(start), strength });
const fact = (id: string, over: Partial<Fact> = {}): Fact => ({
  id, entityId: 'e1', attribute: 'eyes', value: 'green', status: 'proposed', origin: 'ai',
  source: src(0), evidence: [ev(0)], createdAt: 'T', updatedAt: 'T', ...over,
});
const pend = (id: string, over: Partial<PendingProposal> = {}): PendingProposal => ({
  id, ref: { entityId: 'e1' }, attribute: 'past', value: 'pilot', strength: 'suggested', evidence: [ev(5, 'suggested')], createdAt: 'T', ...over,
});
const card = { id: 'c1', kind: 'character' as const, title: 'Ivo', reason: 'Sibling', createdAt: 'T' };
const canon = (bible: Partial<Bible> = {}, extraction: Partial<ExtractionState> = {}): Canon =>
  ({ bible: { ...emptyBible(), ...bible }, extraction: { ...emptyExtraction(), ...extraction } });
let n = 0;
const newId = () => `n${++n}`;

describe('reviewGroups', () => {
  const items = [ent('e2', 'Zed'), ent('e1', 'Mara')];

  it('groups AI proposed facts and pending suggestions by card, new cards last', () => {
    const c = canon(
      { facts: [fact('f1'), fact('f2', { origin: 'manual' }), fact('f3', { status: 'kept' }), fact('f4', { entityId: 'e2' })] },
      { cards: [card], pending: [pend('p1'), pend('p2', { ref: { cardId: 'c1' } })] },
    );
    const groups = reviewGroups(items, c.bible, c.extraction);
    expect(groups.map(g => [g.key, g.facts.map(f => f.id), g.pending.map(p => p.id)])).toEqual([
      ['e1', ['f1'], ['p1']],
      ['e2', ['f4'], []],
      ['c1', [], ['p2']],
    ]);
    expect(groups[2].card).toEqual(card);
    expect(reviewCount(items, c.bible, c.extraction)).toBe(4);
  });
});

describe('approveCard', () => {
  it('turns said proposals into proposed facts on the new entity and keeps suggestions pending on it', () => {
    const c = canon({}, {
      cards: [card],
      pending: [pend('p1', { ref: { cardId: 'c1' }, attribute: 'role', value: 'pilot', strength: 'said', evidence: [ev(1)] }), pend('p2', { ref: { cardId: 'c1' } })],
      rejections: [{ fingerprint: fingerprint('new:character:ivo', 'age', '30'), label: 'age: 30', at: 'T' }],
    });
    const next = approveCard(c, 'c1', 'e9', 'NOW', newId);
    expect(next.bible.facts).toMatchObject([{ entityId: 'e9', attribute: 'role', value: 'pilot', status: 'proposed', origin: 'ai', source: src(1), evidence: [ev(1)] }]);
    expect(next.extraction.cards).toEqual([]);
    expect(next.extraction.pending).toMatchObject([{ id: 'p2', ref: { entityId: 'e9' } }]);
    expect(next.extraction.rejections[0].fingerprint).toBe(fingerprint('e9', 'age', '30'));
  });
});

describe('rejectCard', () => {
  it('records a sticky rejection and removes the card and its proposals', () => {
    const c = canon({}, { cards: [card], pending: [pend('p1', { ref: { cardId: 'c1' } }), pend('p2')] });
    const next = rejectCard(c, 'c1', 'NOW');
    expect(next.extraction.cards).toEqual([]);
    expect(next.extraction.pending.map(p => p.id)).toEqual(['p2']);
    expect(next.extraction.rejections).toEqual([{ fingerprint: cardFingerprint('character', 'Ivo'), label: 'New card: Ivo', at: 'NOW' }]);
  });
});

describe('promote and dismiss', () => {
  it('promote makes a suggestion a proposed fact', () => {
    const next = promote(canon({}, { pending: [pend('p1')] }), 'p1', 'NOW', newId);
    expect(next.extraction.pending).toEqual([]);
    expect(next.bible.facts).toMatchObject([{ entityId: 'e1', attribute: 'past', value: 'pilot', status: 'proposed', origin: 'ai', evidence: [ev(5, 'suggested')] }]);
  });

  it('dismiss records a rejection for the suggestion', () => {
    const next = dismiss(canon({}, { pending: [pend('p1')] }), 'p1', 'NOW');
    expect(next.extraction.pending).toEqual([]);
    expect(next.extraction.rejections).toEqual([{ fingerprint: fingerprint('e1', 'past', 'pilot'), label: 'past: pilot', at: 'NOW' }]);
  });

  it('dismissing a new card\'s proposal keys it to the card', () => {
    const next = dismiss(canon({}, { cards: [card], pending: [pend('p1', { ref: { cardId: 'c1' } })] }), 'p1', 'NOW');
    expect(next.extraction.rejections[0].fingerprint).toBe(fingerprint('new:character:ivo', 'past', 'pilot'));
  });
});

describe('rejectionsFor and liftRejection', () => {
  const bible = { facts: [fact('f1', { status: 'set_aside', value: 'blue' }), fact('f2', { status: 'set_aside', value: 'grey' })], decisions: [{ id: 'd', entityId: 'e1', attribute: 'eyes', kind: 'kept_one' as const, factIds: ['f2'], setAsideIds: ['f2'], at: 'T' }] };
  const extraction = { rejections: [{ fingerprint: fingerprint('e1', 'past', 'pilot'), label: 'past: pilot', at: 'T' }, { fingerprint: fingerprint('e2', 'x', 'y'), label: 'x: y', at: 'T' }] };

  it('lists hand set-asides and stored rejections for the entity, not decided ones', () => {
    const c = canon(bible, extraction);
    expect(rejectionsFor(ent('e1', 'Mara'), c.bible, c.extraction)).toEqual([
      { fingerprint: fingerprint('e1', 'eyes', 'blue'), label: 'eyes: blue', factId: 'f1' },
      { fingerprint: fingerprint('e1', 'past', 'pilot'), label: 'past: pilot' },
    ]);
  });

  it('lifting returns a set-aside fact to review, or forgets a stored rejection', () => {
    const c = canon(bible, extraction);
    const a = liftRejection(c, fingerprint('e1', 'eyes', 'blue'), 'NOW');
    expect(a.bible.facts[0]).toMatchObject({ id: 'f1', status: 'proposed', updatedAt: 'NOW' });
    expect(rejectedFingerprints(a.bible, a.extraction).has(fingerprint('e1', 'eyes', 'blue'))).toBe(false);
    const b = liftRejection(c, fingerprint('e1', 'past', 'pilot'), 'NOW');
    expect(b.extraction.rejections.map(r => r.label)).toEqual(['x: y']);
  });
});

describe('pruneExtraction', () => {
  it('drops proposals about missing entities or cards and runs of deleted sources', () => {
    const x: ExtractionState = {
      ...emptyExtraction(), cards: [card],
      pending: [pend('p1'), pend('p2', { ref: { entityId: 'gone' } }), pend('p3', { ref: { cardId: 'c1' } }), pend('p4', { ref: { cardId: 'gone' } })],
      runs: [{ itemId: 's1', key: 'k', provider: 'gemini', model: 'm', at: 'T', proposals: [], dropped: 0 }, { itemId: 'gone', key: 'k', provider: 'gemini', model: 'm', at: 'T', proposals: [], dropped: 0 }],
    };
    const items = [ent('e1', 'Mara'), { ...ent('s1', 'Chat'), type: 'chat' }];
    const pruned = pruneExtraction(x, items);
    expect(pruned.pending.map(p => p.id)).toEqual(['p1', 'p3']);
    expect(pruned.runs.map(r => r.itemId)).toEqual(['s1']);
    const clean = { ...x, pending: [pend('p1')], runs: [] };
    expect(pruneExtraction(clean, items)).toBe(clean);
  });
});
