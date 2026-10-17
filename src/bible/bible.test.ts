import { describe, expect, it } from 'vitest';
import type { Bible, Decision, Fact, StoryPosition } from '@/project/types';
import {
  comparePositions, emptyBible, formatPosition, isWhenAttribute, normalizeText, positionsCompatible, specificity,
} from '@/bible/normalize';
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
