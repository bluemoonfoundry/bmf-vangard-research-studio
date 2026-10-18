import type { TreeItem } from '@/project/types';
import type { ExtractionState } from '@/extraction/types';

/** Review-queue state changes for AI extraction. Pure: no React, no IPC. */

/**
 * Drops pending proposals about entities or cards that no longer exist, and cached runs of deleted
 * sources. Returns `x` itself when nothing is orphaned.
 */
export function pruneExtraction(x: ExtractionState, items: readonly TreeItem[]): ExtractionState {
  const entities = new Set(items.filter(i => i.type === 'entity').map(i => i.id));
  const ids = new Set(items.map(i => i.id));
  const cards = new Set(x.cards.map(c => c.id));
  const pending = x.pending.filter(p => ('entityId' in p.ref ? entities.has(p.ref.entityId) : cards.has(p.ref.cardId)));
  const runs = x.runs.filter(r => ids.has(r.itemId));
  if (pending.length === x.pending.length && runs.length === x.runs.length) return x;
  return { ...x, pending, runs };
}
