import type { TreeItem } from '@/project/types';

/** Pure operations on the flat binder item list (tree.json). */

export type DropPosition = 'before' | 'after' | 'inside';

export const byOrder = (a: TreeItem, b: TreeItem) => a.order - b.order;

export function childrenOf(items: TreeItem[], parentId: string | null): TreeItem[] {
  return items.filter(i => i.parentId === parentId).sort(byOrder);
}

/** `id` plus everything nested under it. */
export function descendantIds(items: TreeItem[], id: string): Set<string> {
  const ids = new Set([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const item of items) {
      if (item.parentId !== null && ids.has(item.parentId) && !ids.has(item.id)) {
        ids.add(item.id);
        grew = true;
      }
    }
  }
  return ids;
}

/** The chain of parents above `id`, outermost first. Stops at a missing parent or a cycle. */
export function ancestorsOf(items: TreeItem[], id: string): TreeItem[] {
  const byId = new Map(items.map(i => [i.id, i]));
  const chain: TreeItem[] = [];
  const seen = new Set([id]);
  let parentId = byId.get(id)?.parentId ?? null;
  while (parentId !== null && !seen.has(parentId)) {
    const parent = byId.get(parentId);
    if (!parent) break;
    chain.unshift(parent);
    seen.add(parentId);
    parentId = parent.parentId;
  }
  return chain;
}

/** An order value that sorts after every current child of `parentId`. */
export function nextOrder(items: TreeItem[], parentId: string | null): number {
  return items.reduce((max, i) => (i.parentId === parentId ? Math.max(max, i.order + 1) : max), 0);
}

export const isFolder = (item: TreeItem | undefined) => item?.type === 'folder';

/**
 * Moves `draggedId` before/after `targetId`, or inside it (a folder, or the
 * root when `targetId` is null). Returns the new item list, or null when the
 * move is impossible (into its own subtree, onto a non-folder) or changes nothing.
 * Only items whose parent or order changes are replaced.
 */
export function moveItem(items: TreeItem[], draggedId: string, targetId: string | null, position: DropPosition): TreeItem[] | null {
  const dragged = items.find(i => i.id === draggedId);
  if (!dragged) return null;
  if (targetId !== null && descendantIds(items, draggedId).has(targetId)) return null;

  let parentId: string | null;
  let insertAt: number;
  const siblingsOf = (pid: string | null) => childrenOf(items, pid).filter(i => i.id !== draggedId);

  if (position === 'inside') {
    if (targetId !== null && !isFolder(items.find(i => i.id === targetId))) return null;
    parentId = targetId;
    insertAt = siblingsOf(parentId).length;
  } else {
    const target = items.find(i => i.id === targetId);
    if (!target) return null;
    parentId = target.parentId;
    const index = siblingsOf(parentId).findIndex(i => i.id === targetId);
    insertAt = position === 'before' ? index : index + 1;
  }

  const ordered = siblingsOf(parentId);
  ordered.splice(insertAt, 0, dragged);
  const orders = new Map(ordered.map((item, index) => [item.id, index]));

  let changed = false;
  const next = items.map((item) => {
    if (!orders.has(item.id)) return item;
    const order = orders.get(item.id)!;
    const newParent = item.id === draggedId ? parentId : item.parentId;
    if (item.order === order && item.parentId === newParent) return item;
    changed = true;
    return { ...item, parentId: newParent, order };
  });
  return changed ? next : null;
}

/**
 * Copies `id` and its whole subtree with fresh ids. The copy of `id` is titled
 * "<title> (copy)" and sorts directly after the original; descendants keep
 * their relative structure. References within the copied subtree are pointed
 * at the copies. Returns the new items and the old->new id map.
 */
export function duplicateSubtree(
  items: TreeItem[],
  id: string,
  newId: () => string,
  now: string,
): { added: TreeItem[]; idMap: Map<string, string> } {
  const source = items.find(i => i.id === id);
  if (!source) return { added: [], idMap: new Map() };

  const subtree = descendantIds(items, id);
  const idMap = new Map([...subtree].map(oldId => [oldId, newId()]));
  const siblings = childrenOf(items, source.parentId);
  const following = siblings[siblings.findIndex(i => i.id === id) + 1];
  const copyOrder = following ? (source.order + following.order) / 2 : source.order + 1;

  const added = items
    .filter(i => subtree.has(i.id))
    .map((item): TreeItem => {
      const isRoot = item.id === id;
      return {
        ...structuredClone(item),
        id: idMap.get(item.id)!,
        parentId: isRoot ? item.parentId : idMap.get(item.parentId!)!,
        title: isRoot ? `${item.title} (copy)` : item.title,
        order: isRoot ? copyOrder : item.order,
        references: item.references?.map(r => ({
          ...r,
          id: newId(),
          targetId: idMap.get(r.targetId) ?? r.targetId,
        })),
        createdAt: now,
        updatedAt: now,
      };
    });
  return { added, idMap };
}
