import { describe, expect, it } from 'vitest';
import type { Bible, DatedAge, Fact } from '@/project/types';
import { ageAtStart, groupDatedAges, startAge, startAgeText } from '@/bible/ages';

let n = 0;
const age = (value: Fact['value'], status: Fact['status'] = 'kept', entityId = 'e1'): Fact => ({
  id: `f${++n}`, entityId, attribute: 'age', value, status, origin: 'manual', createdAt: 'T0', updatedAt: 'T0',
});
const bibleOf = (facts: Fact[]): Bible => ({ facts, dependencies: [], decisions: [] });
const at = (a: number, year: number): DatedAge => ({ age: a, year });

describe('ages', () => {
  it('computes the implied start age', () => {
    expect(startAge(at(18, 12))).toBe(6);
    expect(startAge(at(3, 10))).toBe(-7);
  });

  it('groups by implied start age with a 2-year threshold', () => {
    const g = groupDatedAges([at(18, 12), at(6, 0), at(17, 12)], a => a);
    // start ages 6, 6, 5; ties keep input order
    expect(g).toEqual([[at(17, 12), at(18, 12), at(6, 0)]]);
    expect(groupDatedAges([at(6, 0), at(20, 12)], a => a)).toEqual([[at(6, 0)], [at(20, 12)]]);
  });

  it('splits a near-miss chain deterministically', () => {
    const ages = [at(2, 0), at(0, 0), at(1, 0)];
    const expected = [[at(0, 0), at(1, 0)], [at(2, 0)]];
    expect(groupDatedAges(ages, a => a)).toEqual(expected);
    expect(groupDatedAges([...ages].reverse(), a => a)).toEqual(expected);
  });

  it('describes the start age', () => {
    expect(startAgeText([at(6, 0), at(18, 12)])).toBe('6 at the start');
    expect(startAgeText([at(5, 0), at(18, 12)])).toBe('5–6 at the start');
    expect(startAgeText([at(3, 10)])).toBe('born in year 7');
    expect(startAgeText([at(3, 10), at(4, 10)])).toBe('born in years 6–7');
    expect(startAgeText([at(0, 0)])).toBe('born in year 0');
  });

  it('ageAtStart uses kept dated ages only and gives up on a conflict', () => {
    expect(ageAtStart(bibleOf([age(at(6, 0)), age(at(18, 12)), age(at(9, 0), 'proposed')]), 'e1')).toBe('6 at the start');
    expect(ageAtStart(bibleOf([age(at(6, 0)), age(at(9, 0))]), 'e1')).toBeNull();
    expect(ageAtStart(bibleOf([age('6')]), 'e1')).toBeNull();
    expect(ageAtStart(bibleOf([age(at(6, 0), 'kept', 'other')]), 'e1')).toBeNull();
  });
});
