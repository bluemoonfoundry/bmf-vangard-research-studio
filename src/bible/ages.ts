import type { Bible, DatedAge } from '@/project/types';
import { isAgeAttribute, isDatedAge, normalizeText } from '@/bible/normalize';

/**
 * Ages over story time. A dated age ("18 at year 12") implies an age at the story's start
 * (age − year); dated ages agree when those start ages are less than AGE_TOLERANCE apart.
 * Plain-text ages are never compared.
 */

export const AGE_TOLERANCE = 2;

export const startAge = (a: DatedAge): number => a.age - a.year;

/**
 * Groups items whose start ages agree: sorted by start age (ties keep input order), a new group
 * starts once an item is AGE_TOLERANCE or more above its group's first. The same items give the
 * same groups whatever their input order (apart from ties).
 */
export function groupDatedAges<T>(items: T[], ageOf: (t: T) => DatedAge): T[][] {
  const sorted = items.map((t, i) => ({ t, i, s: startAge(ageOf(t)) })).sort((a, b) => a.s - b.s || a.i - b.i);
  const groups: { first: number; items: T[] }[] = [];
  for (const x of sorted) {
    const last = groups.at(-1);
    if (last && x.s - last.first < AGE_TOLERANCE) last.items.push(x.t);
    else groups.push({ first: x.s, items: [x.t] });
  }
  return groups.map(g => g.items);
}

const DATED_AGE = /^(?:age )?(\d+)(?: years? old)?(?: at year (\d+)| \(year (\d+)\))$/;

/** "18 at year 12", "age 18 at year 12", "18 years old at year 12" or "18 (year 12)"; anything else is null. */
export function parseDatedAge(text: string): DatedAge | null {
  const m = DATED_AGE.exec(normalizeText(text));
  return m ? { age: Number(m[1]), year: Number(m[2] ?? m[3]) } : null;
}

const span = (lo: number, hi: number): string => (lo === hi ? String(lo) : `${lo}–${hi}`);

/** One agreeing group, read as "6 at the start" / "5–6 at the start", or "born in year 7" when born after it. */
export function startAgeText(ages: DatedAge[]): string {
  const starts = ages.map(startAge);
  const lo = Math.min(...starts);
  const hi = Math.max(...starts);
  if (hi <= 0) return lo === hi ? `born in year ${-hi}` : `born in years ${span(-hi, -lo)}`;
  return `${span(lo, hi)} at the start`;
}

/** The entity's kept dated ages read as a start age, or null when there are none or they conflict. */
export function ageAtStart(bible: Bible, entityId: string): string | null {
  const ages: DatedAge[] = [];
  for (const f of bible.facts) {
    if (f.entityId === entityId && f.status === 'kept' && isAgeAttribute(f.attribute) && isDatedAge(f.value)) ages.push(f.value);
  }
  const groups = groupDatedAges(ages, a => a);
  return groups.length === 1 ? startAgeText(groups[0]) : null;
}
