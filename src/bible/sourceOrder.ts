import type { Bible, TreeItem } from '@/project/types';

/**
 * The project's source order: chats, AI chats and documents, oldest first, kept in
 * `bible.sourceOrder`. When two sources disagree, VRS suggests keeping the newer one. Sources
 * missing from the list (items from before it existed) count as oldest.
 */

export const SOURCE_TYPES: readonly string[] = ['chat', 'ai-chat', 'document'];

export const isSourceItem = (item: Pick<TreeItem, 'type'>): boolean => SOURCE_TYPES.includes(item.type);

/** Oldest first: sources missing from the list (binder order), then listed ones in list order. */
export function orderedSources(b: Bible, items: readonly TreeItem[]): TreeItem[] {
  const sources = items.filter(isSourceItem);
  const byId = new Map(sources.map(i => [i.id, i]));
  const listed = (b.sourceOrder ?? []).filter(id => byId.has(id));
  const listedSet = new Set(listed);
  return [...sources.filter(i => !listedSet.has(i.id)), ...listed.map(id => byId.get(id)!)];
}

export const setSourceOrder = (b: Bible, ids: string[]): Bible => ({ ...b, sourceOrder: [...ids] });

/**
 * Stores the full order: orderedSources(b, items) minus `ids`, with `ids` (in the given order)
 * spliced in at `index`. `ids` need not be in `items`, so callers pass the items from before the
 * new ones were added.
 */
export function insertSources(b: Bible, items: readonly TreeItem[], ids: string[], index: number): Bible {
  const moving = new Set(ids);
  const rest = orderedSources(b, items).map(i => i.id).filter(id => !moving.has(id));
  const at = Math.max(0, Math.min(index, rest.length));
  return setSourceOrder(b, [...rest.slice(0, at), ...ids, ...rest.slice(at)]);
}

/** Adds ids as newest; ids already listed stay where they are. Returns `b` when nothing changes. */
export function appendSources(b: Bible, ids: string[]): Bible {
  const order = b.sourceOrder ?? [];
  const fresh = ids.filter(id => !order.includes(id));
  return fresh.length ? setSourceOrder(b, [...order, ...fresh]) : b;
}
