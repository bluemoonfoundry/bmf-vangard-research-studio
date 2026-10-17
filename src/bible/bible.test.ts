import { describe, expect, it } from 'vitest';
import type { Bible, Decision, Fact, StoryPosition } from '@/project/types';
import {
  comparePositions, emptyBible, formatPosition, isWhenAttribute, normalizeText, positionsCompatible, specificity,
} from '@/bible/normalize';
import {
  addDependency, addFact, keepAll, keepOne, removeDependency, removeEntities, reopen, setFactStatus, updateFact,
} from '@/bible/ops';
import { contradictionKey, findContradictions, groupVersions, openContradictions } from '@/bible/contradictions';

let n = 0;
const fact = (over: Partial<Fact> = {}): Fact => ({
  id: `f${++n}`, entityId: 'e1', attribute: 'Death', value: 'x', status: 'kept', origin: 'manual',
  createdAt: 'T0', updatedAt: 'T0', ...over,
});
const bibleOf = (facts: Fact[], decisions: Decision[] = []): Bible => ({ facts, dependencies: [], decisions });
const pos = (season: number, episode?: number, order?: number): StoryPosition => ({ season, episode, order });

describe('normalize', () => {
  it('normalizes text', () => {
    expect(normalizeText('  Season\t 3 ')).toBe('season 3');
    expect(isWhenAttribute(' When ')).toBe(true);
    expect(isWhenAttribute('whence')).toBe(false);
  });
  it('checks position compatibility', () => {
    expect(positionsCompatible({ season: 3 }, { season: 3, episode: 4 })).toBe(true);
    expect(positionsCompatible({ season: 3, episode: 4 }, { season: 3, episode: 5 })).toBe(false);
  });
  it('orders positions with missing parts first', () => {
    const order = [pos(4), pos(3, 1, 2), pos(3), pos(3, 1)].sort(comparePositions);
    expect(order.map(formatPosition)).toEqual(['Season 3', 'S3 · E1', 'S3 · E1 · #2', 'Season 4']);
  });
  it('computes specificity, formatting and empty bible', () => {
    expect(specificity({ season: 1 })).toBe(0);
    expect(specificity({ season: 1, episode: 2 })).toBe(1);
    expect(specificity({ season: 1, episode: 2, order: 3 })).toBe(2);
    expect(formatPosition({ season: 3, episode: 4 })).toBe('S3 · E4');
    expect(emptyBible()).toEqual({ facts: [], dependencies: [], decisions: [] });
  });
});

describe('contradictions', () => {
  it('groups text values by normalized value', () => {
    const vs = groupVersions([fact({ value: 'Season 3' }), fact({ value: 'season  3' })]);
    expect(vs).toHaveLength(1);
    expect(vs[0].facts).toHaveLength(2);
    expect(vs[0].value).toBe('Season 3');
  });
  it('groups compatible positions under the most specific', () => {
    const vs = groupVersions([fact({ attribute: 'when', value: pos(3) }), fact({ attribute: 'when', value: pos(3, 4) })]);
    expect(vs).toHaveLength(1);
    expect(vs[0].value).toEqual(pos(3, 4));
    const vs2 = groupVersions([
      fact({ attribute: 'when', value: pos(3, 4) }), fact({ attribute: 'when', value: pos(3, 5) }),
      fact({ attribute: 'when', value: pos(3) }),
    ]);
    expect(vs2).toHaveLength(2);
  });
  const ents = new Set(['e1']);
  it('finds contradictions across attribute spellings', () => {
    const cs = findContradictions(bibleOf([
      fact({ attribute: 'Death ', value: 'a' }), fact({ attribute: 'death', value: 'b' }),
    ]), ents);
    expect(cs).toHaveLength(1);
    expect(cs[0].versions).toHaveLength(2);
    expect(cs[0].key).toBe(contradictionKey('e1', 'DEATH'));
    expect(openContradictions(cs)).toHaveLength(1);
  });
  it('ignores set_aside facts and unknown entities', () => {
    expect(findContradictions(bibleOf([fact({ value: 'a' }), fact({ value: 'b', status: 'set_aside' })]), ents)).toEqual([]);
    expect(findContradictions(bibleOf([fact({ value: 'a' }), fact({ value: 'b', entityId: 'gone' })]), ents)).toEqual([]);
  });
  it('acknowledges with a matching kept_all decision until a new fact appears', () => {
    const a = fact({ value: 'a' });
    const b = fact({ value: 'b' });
    const decision: Decision = {
      id: 'd1', entityId: 'e1', attribute: 'death', kind: 'kept_all',
      factIds: [b.id, a.id].sort(), setAsideIds: [], at: 'T1',
    };
    const [c] = findContradictions(bibleOf([a, b], [decision]), ents);
    expect(c.acknowledgedBy).toEqual(decision);
    expect(openContradictions([c])).toEqual([]);
    const [c2] = findContradictions(bibleOf([a, b, fact({ value: 'c' })], [decision]), ents);
    expect(c2.acknowledgedBy).toBeNull();
  });
  it('does not flag a proposed fact equal to the kept value', () => {
    expect(findContradictions(bibleOf([fact({ value: 'a' }), fact({ value: 'A', status: 'proposed' })]), ents)).toEqual([]);
  });
});

describe('ops', () => {
  const ents = new Set(['e1']);
  const two = () => {
    const a = fact({ id: 'a', value: 'alive' });
    const b = fact({ id: 'b', value: 'dead' });
    return { a, b, bible: bibleOf([a, b]) };
  };
  const decision = { id: 'd1', note: 'n', now: 'T1' };

  it('addFact, updateFact and setFactStatus are pure and stamp updatedAt', () => {
    const { bible } = two();
    const added = addFact(bible, fact({ id: 'c' }));
    expect(added.facts).toHaveLength(3);
    expect(bible.facts).toHaveLength(2);
    const upd = updateFact(bible, 'a', { value: 'zzz', note: 'hi' }, 'T9');
    expect(upd.facts[0]).toMatchObject({ value: 'zzz', note: 'hi', updatedAt: 'T9', id: 'a', createdAt: 'T0' });
    expect(bible.facts[0].value).toBe('alive');
    const st = setFactStatus(bible, 'b', 'set_aside', 'T9');
    expect(st.facts[1]).toMatchObject({ status: 'set_aside', updatedAt: 'T9' });
    expect(bible.facts[1].status).toBe('kept');
  });

  it('keepOne keeps the chosen version, sets the other aside and records a decision', () => {
    const { bible } = two();
    const c = findContradictions(bible, ents)[0];
    const idx = c.versions.findIndex(v => v.value === 'alive');
    const out = keepOne(bible, c, idx, decision);
    expect(out.facts.find(f => f.id === 'a')?.status).toBe('kept');
    expect(out.facts.find(f => f.id === 'b')?.status).toBe('set_aside');
    expect(out.decisions).toHaveLength(1);
    expect(out.decisions[0]).toMatchObject({
      id: 'd1', kind: 'kept_one', entityId: 'e1', attribute: 'Death', factIds: c.factIds, setAsideIds: ['b'], note: 'n', at: 'T1',
    });
    expect(findContradictions(out, ents)).toEqual([]);
    expect(bible.decisions).toHaveLength(0);
  });

  it('reopen restores set-aside facts and the contradiction reappears', () => {
    const { bible } = two();
    const c = findContradictions(bible, ents)[0];
    const out = reopen(keepOne(bible, c, 0, decision), 'd1', 'T2');
    expect(out.facts.map(f => f.status)).toEqual(['kept', 'kept']);
    expect(out.decisions).toEqual([]);
    expect(findContradictions(out, ents)).toHaveLength(1);
  });

  it('reopen does not restore a fact set aside before the decision', () => {
    const a = fact({ id: 'a', value: 'alive' });
    const b = fact({ id: 'b', value: 'dead' });
    const x = fact({ id: 'x', value: 'missing', status: 'set_aside' });
    const bible = bibleOf([a, b, x]);
    const c = findContradictions(bible, ents)[0];
    const out = reopen(keepOne(bible, c, 0, decision), 'd1', 'T2');
    expect(out.facts.find(f => f.id === 'x')?.status).toBe('set_aside');
  });

  it('keepAll twice on the same key leaves one decision', () => {
    const { bible } = two();
    const c = findContradictions(bible, ents)[0];
    const once = keepAll(bible, c, { id: 'd1', now: 'T1' });
    expect(findContradictions(once, ents)[0].acknowledgedBy?.id).toBe('d1');
    const twice = keepAll(once, c, { id: 'd2', now: 'T2' });
    expect(twice.decisions.map(d => d.id)).toEqual(['d2']);
    expect(twice.decisions[0].kind).toBe('kept_all');
  });

  it('addDependency ignores self and duplicate pairs; removeDependency removes', () => {
    const b0 = emptyBible();
    expect(addDependency(b0, { id: 'x', eventId: 'e', afterEventId: 'e' }).dependencies).toEqual([]);
    const b1 = addDependency(b0, { id: 'x', eventId: 'e', afterEventId: 'f' });
    expect(b1.dependencies).toHaveLength(1);
    expect(addDependency(b1, { id: 'y', eventId: 'e', afterEventId: 'f' }).dependencies).toHaveLength(1);
    expect(removeDependency(b1, 'x').dependencies).toEqual([]);
  });

  it('removeEntities cascades but keeps facts that only cite a removed item', () => {
    const bible: Bible = {
      facts: [fact({ id: 'a', entityId: 'ev' }), fact({ id: 'b', entityId: 'other', source: { itemId: 'ev', quote: 'q', start: 0, end: 1 } })],
      dependencies: [
        { id: 'd1', eventId: 'ev', afterEventId: 'o' },
        { id: 'd2', eventId: 'o', afterEventId: 'ev' },
        { id: 'd3', eventId: 'o', afterEventId: 'p' },
      ],
      decisions: [
        { id: 'k1', entityId: 'ev', attribute: 'x', kind: 'kept_all', factIds: [], setAsideIds: [], at: 'T' },
        { id: 'k2', entityId: 'other', attribute: 'x', kind: 'kept_all', factIds: [], setAsideIds: [], at: 'T' },
      ],
    };
    const out = removeEntities(bible, new Set(['ev']));
    expect(out.facts.map(f => f.id)).toEqual(['b']);
    expect(out.dependencies.map(d => d.id)).toEqual(['d3']);
    expect(out.decisions.map(d => d.id)).toEqual(['k2']);
  });
});
