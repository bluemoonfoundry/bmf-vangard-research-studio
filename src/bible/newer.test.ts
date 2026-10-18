import { describe, expect, it } from 'vitest';
import type { Fact } from '@/project/types';
import { emptyBible } from '@/bible/normalize';
import { findContradictions } from '@/bible/contradictions';
import { newerVersion } from '@/bible/newer';

const fact = (id: string, value: string, items: string[]): Fact => ({
  id, entityId: 'e1', attribute: 'eyes', value, status: 'proposed', origin: 'ai', createdAt: 'T', updatedAt: 'T',
  source: { itemId: items[0], quote: 'q', start: 0, end: 1 },
  evidence: items.map(itemId => ({ source: { itemId, quote: 'q', start: 0, end: 1 }, strength: 'said' as const })),
});
const conflict = (...facts: Fact[]) => findContradictions({ ...emptyBible(), facts }, new Set(['e1']))[0];
const valueAt = (facts: Fact[], order: string[]) => {
  const c = conflict(...facts);
  const i = newerVersion(c, order);
  return i === null ? null : c.versions[i].value;
};

describe('newerVersion', () => {
  it('picks the version whose latest evidence is furthest down the source order', () => {
    expect(valueAt([fact('a', 'green', ['old']), fact('b', 'blue', ['new'])], ['old', 'new'])).toBe('blue');
    expect(valueAt([fact('a', 'green', ['old', 'newest']), fact('b', 'blue', ['new'])], ['old', 'new', 'newest'])).toBe('green');
  });

  it('counts sources missing from the order as oldest', () => {
    expect(valueAt([fact('a', 'green', ['unlisted']), fact('b', 'blue', ['listed'])], ['listed'])).toBe('blue');
  });

  it('suggests nothing when both versions come from one source, or their latest sources tie', () => {
    expect(valueAt([fact('a', 'green', ['s']), fact('b', 'blue', ['s'])], ['s'])).toBeNull();
    expect(valueAt([fact('a', 'green', ['x', 'z']), fact('b', 'blue', ['y', 'z'])], ['x', 'y', 'z'])).toBeNull();
  });

  it('suggests nothing for versions without sources', () => {
    const manual = (id: string, value: string): Fact => ({ id, entityId: 'e1', attribute: 'eyes', value, status: 'kept', origin: 'manual', createdAt: 'T', updatedAt: 'T' });
    expect(valueAt([manual('a', 'green'), manual('b', 'blue')], [])).toBeNull();
  });
});
