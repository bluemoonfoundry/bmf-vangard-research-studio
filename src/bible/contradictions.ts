import type { Bible, Decision, Fact, FactValue, StoryPosition } from '@/project/types';
import { attributeKey, isPosition, normalizeText, positionsCompatible, specificity } from '@/bible/normalize';

export interface Version { value: FactValue; facts: Fact[] }

export interface Contradiction {
  key: string;
  entityId: string;
  attribute: string;
  versions: Version[];
  /** Sorted ids of the live facts in the group. */
  factIds: string[];
  acknowledgedBy: Decision | null;
}

export const contradictionKey = (entityId: string, attribute: string): string =>
  `${entityId}\u0000${attributeKey(attribute)}`;

/** Groups facts that agree: equal text after normalizing, or compatible story positions. */
export function groupVersions(facts: Fact[]): Version[] {
  const versions: Version[] = [];
  const positional = facts.filter(f => isPosition(f.value));
  const textual = facts.filter(f => typeof f.value === 'string');

  for (const f of textual) {
    const norm = normalizeText(f.value as string);
    const hit = versions.find(v => typeof v.value === 'string' && normalizeText(v.value) === norm);
    if (hit) hit.facts.push(f);
    else versions.push({ value: f.value, facts: [f] });
  }

  const sorted = [...positional].sort((a, b) => specificity(b.value as StoryPosition) - specificity(a.value as StoryPosition));
  for (const f of sorted) {
    const p = f.value as StoryPosition;
    const hit = versions.find(v => isPosition(v.value) && positionsCompatible(v.value, p));
    if (hit) hit.facts.push(f);
    else versions.push({ value: p, facts: [f] });
  }
  return versions;
}

export function findContradictions(bible: Bible, entityIds: ReadonlySet<string>): Contradiction[] {
  const groups = new Map<string, { entityId: string; attribute: string; facts: Fact[] }>();
  for (const f of bible.facts) {
    if (f.status === 'set_aside' || !entityIds.has(f.entityId)) continue;
    const key = contradictionKey(f.entityId, f.attribute);
    const g = groups.get(key);
    if (g) g.facts.push(f);
    else groups.set(key, { entityId: f.entityId, attribute: f.attribute, facts: [f] });
  }

  const out: Contradiction[] = [];
  for (const [key, g] of groups) {
    const versions = groupVersions(g.facts);
    if (versions.length < 2) continue;
    const factIds = g.facts.map(f => f.id).sort();
    const acknowledgedBy = [...bible.decisions].reverse().find(d =>
      d.kind === 'kept_all'
      && contradictionKey(d.entityId, d.attribute) === key
      && d.factIds.length === factIds.length
      && [...d.factIds].sort().every((id, i) => id === factIds[i])) ?? null;
    out.push({ key, entityId: g.entityId, attribute: g.attribute, versions, factIds, acknowledgedBy });
  }
  return out;
}

export const openContradictions = (cs: Contradiction[]): Contradiction[] => cs.filter(c => !c.acknowledgedBy);
