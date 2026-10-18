import type { Bible, TreeItem } from '@/project/types';
import type { ExtractionState } from '@/extraction/types';

/** Keeps extraction state free of references to deleted items (used by the save). */

/**
 * Drops pending proposals about entities or cards that no longer exist, cached runs of deleted
 * sources, and (given the bible) conflict flags on deleted facts. Returns `x` itself when nothing is orphaned.
 */
export function pruneExtraction(x: ExtractionState, items: readonly TreeItem[], bible?: Bible): ExtractionState {
  const entities = new Set(items.filter(i => i.type === 'entity').map(i => i.id));
  const ids = new Set(items.map(i => i.id));
  const cards = new Set(x.cards.map(c => c.id));
  const pending = x.pending.filter(p => ('entityId' in p.ref ? entities.has(p.ref.entityId) : cards.has(p.ref.cardId)));
  const runs = x.runs.filter(r => ids.has(r.itemId));
  const facts = bible && new Set(bible.facts.map(f => f.id));
  const flags = facts && x.flags?.filter(f => facts.has(f.factIds[0]) && facts.has(f.factIds[1]));
  const flagsPruned = !!flags && flags.length !== x.flags?.length;
  if (pending.length === x.pending.length && runs.length === x.runs.length && !flagsPruned) return x;
  return { ...x, pending, runs, ...(flagsPruned && { flags }) };
}
