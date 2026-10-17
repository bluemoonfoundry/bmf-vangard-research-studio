import type { Bible, StoryPosition } from '@/project/types';
import { groupVersions } from '@/bible/contradictions';
import { isWhenAttribute } from '@/bible/normalize';

export type Check = 'ok' | 'violated' | 'unknown';

/** Whether `a` is strictly later than `b`; unknown when the shared parts cannot decide. */
export function strictlyAfter(a: StoryPosition, b: StoryPosition): 'yes' | 'no' | 'unknown' {
  if (a.season !== b.season) return a.season > b.season ? 'yes' : 'no';
  if (a.episode === undefined || b.episode === undefined) return 'unknown';
  if (a.episode !== b.episode) return a.episode > b.episode ? 'yes' : 'no';
  if (a.order === undefined || b.order === undefined) return 'unknown';
  return a.order > b.order ? 'yes' : 'no';
}

/** One position per kept `when` version of the event; proposed facts do not count. */
export function keptPositions(b: Bible, eventId: string): StoryPosition[] {
  const facts = b.facts.filter(f => f.entityId === eventId && f.status === 'kept' && isWhenAttribute(f.attribute)
    && typeof f.value === 'object' && f.value !== null);
  return groupVersions(facts).map(v => v.value as StoryPosition);
}

export interface DependencyCheck {
  dependencyId: string;
  otherEventId: string;
  direction: 'after' | 'before';
  result: Check;
}

function combine(results: Check[]): Check {
  if (results.length === 0) return 'unknown';
  if (results.every(r => r === 'ok')) return 'ok';
  if (results.every(r => r === 'violated')) return 'violated';
  return 'unknown';
}

/** Checks a candidate position for an event against every dependency it takes part in. */
export function checkPosition(b: Bible, eventId: string, candidate: StoryPosition): DependencyCheck[] {
  const out: DependencyCheck[] = [];
  for (const dep of b.dependencies) {
    let direction: 'after' | 'before';
    let otherEventId: string;
    if (dep.eventId === eventId) { direction = 'after'; otherEventId = dep.afterEventId; }
    else if (dep.afterEventId === eventId) { direction = 'before'; otherEventId = dep.eventId; }
    else continue;
    const results = keptPositions(b, otherEventId).map((p): Check => {
      const r = direction === 'after' ? strictlyAfter(candidate, p) : strictlyAfter(p, candidate);
      return r === 'yes' ? 'ok' : r === 'no' ? 'violated' : 'unknown';
    });
    out.push({ dependencyId: dep.id, otherEventId, direction, result: combine(results) });
  }
  return out;
}

/** Events that can reach themselves by following `afterEventId` edges. */
export function eventsInCycles(b: Bible): Set<string> {
  const next = new Map<string, string[]>();
  for (const d of b.dependencies) next.set(d.eventId, [...(next.get(d.eventId) ?? []), d.afterEventId]);
  const result = new Set<string>();
  for (const start of next.keys()) {
    const seen = new Set<string>();
    const stack = [...(next.get(start) ?? [])];
    while (stack.length > 0) {
      const id = stack.pop() as string;
      if (id === start) { result.add(start); break; }
      if (seen.has(id)) continue;
      seen.add(id);
      stack.push(...(next.get(id) ?? []));
    }
  }
  return result;
}
