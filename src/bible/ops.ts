import type { Bible, Decision, Dependency, Fact, FactStatus, TreeItem } from '@/project/types';
import { contradictionKey, type Contradiction } from '@/bible/contradictions';

interface DecisionArgs { id: string; note?: string; now: string }

const mapFacts = (b: Bible, fn: (f: Fact) => Fact): Bible => ({ ...b, facts: b.facts.map(fn) });

export const addFact = (b: Bible, fact: Fact): Bible => ({ ...b, facts: [...b.facts, fact] });

export const updateFact = (
  b: Bible, id: string, patch: Partial<Omit<Fact, 'id' | 'createdAt'>>, now: string,
): Bible => mapFacts(b, f => (f.id === id ? { ...f, ...patch, updatedAt: now } : f));

export const setFactStatus = (b: Bible, id: string, status: FactStatus, now: string): Bible =>
  updateFact(b, id, { status }, now);

function applyStatuses(b: Bible, statuses: Map<string, FactStatus>, now: string): Bible {
  return mapFacts(b, f => {
    const status = statuses.get(f.id);
    return status && status !== f.status ? { ...f, status, updatedAt: now } : f;
  });
}

export function keepOne(b: Bible, c: Contradiction, versionIndex: number, d: DecisionArgs): Bible {
  const statuses = new Map<string, FactStatus>();
  const setAsideIds: string[] = [];
  c.versions.forEach((v, i) => {
    for (const f of v.facts) {
      if (i === versionIndex) statuses.set(f.id, 'kept');
      else { statuses.set(f.id, 'set_aside'); setAsideIds.push(f.id); }
    }
  });
  const decision: Decision = {
    id: d.id, entityId: c.entityId, attribute: c.attribute, kind: 'kept_one',
    factIds: c.factIds, setAsideIds, ...(d.note !== undefined && { note: d.note }), at: d.now,
  };
  const next = applyStatuses(b, statuses, d.now);
  return { ...next, decisions: [...next.decisions, decision] };
}

export function keepAll(b: Bible, c: Contradiction, d: DecisionArgs): Bible {
  const statuses = new Map<string, FactStatus>(c.factIds.map(id => [id, 'kept']));
  const decision: Decision = {
    id: d.id, entityId: c.entityId, attribute: c.attribute, kind: 'kept_all',
    factIds: c.factIds, setAsideIds: [], ...(d.note !== undefined && { note: d.note }), at: d.now,
  };
  const next = applyStatuses(b, statuses, d.now);
  const decisions = next.decisions.filter(x =>
    !(x.kind === 'kept_all' && contradictionKey(x.entityId, x.attribute) === c.key));
  return { ...next, decisions: [...decisions, decision] };
}

export function reopen(b: Bible, decisionId: string, now: string): Bible {
  const decision = b.decisions.find(d => d.id === decisionId);
  if (!decision) return b;
  const restore = new Set(decision.setAsideIds);
  const next = mapFacts(b, f =>
    (restore.has(f.id) && f.status === 'set_aside' ? { ...f, status: 'kept', updatedAt: now } : f));
  return { ...next, decisions: next.decisions.filter(d => d.id !== decisionId) };
}

export function addDependency(b: Bible, dep: Dependency): Bible {
  if (dep.eventId === dep.afterEventId) return b;
  if (b.dependencies.some(x => x.eventId === dep.eventId && x.afterEventId === dep.afterEventId)) return b;
  return { ...b, dependencies: [...b.dependencies, dep] };
}

export const removeDependency = (b: Bible, id: string): Bible =>
  ({ ...b, dependencies: b.dependencies.filter(d => d.id !== id) });

export const removeEntities = (b: Bible, ids: ReadonlySet<string>): Bible => ({
  ...b,
  facts: b.facts.filter(f => !ids.has(f.entityId)),
  dependencies: b.dependencies.filter(d => !ids.has(d.eventId) && !ids.has(d.afterEventId)),
  decisions: b.decisions.filter(d => !ids.has(d.entityId)),
});

/**
 * Drops facts and decisions about entities that no longer exist, dependencies
 * between events that no longer exist, and source-order ids of deleted items.
 * Returns `b` itself when nothing is orphaned.
 */
export function pruneOrphans(b: Bible, items: readonly TreeItem[]): Bible {
  const entities = new Set(items.filter(i => i.type === 'entity').map(i => i.id));
  const facts = b.facts.filter(f => entities.has(f.entityId));
  const dependencies = b.dependencies.filter(d => entities.has(d.eventId) && entities.has(d.afterEventId));
  const decisions = b.decisions.filter(d => entities.has(d.entityId));
  const ids = new Set(items.map(i => i.id));
  const sourceOrder = b.sourceOrder?.filter(id => ids.has(id));
  if (facts.length === b.facts.length && dependencies.length === b.dependencies.length && decisions.length === b.decisions.length
    && sourceOrder?.length === b.sourceOrder?.length) return b;
  return sourceOrder ? { ...b, facts, dependencies, decisions, sourceOrder } : { ...b, facts, dependencies, decisions };
}
