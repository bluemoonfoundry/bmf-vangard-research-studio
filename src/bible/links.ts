import type { Bible, Fact, TreeItem } from '@/project/types';

/** Event entities whose references point at the given entity, in binder order. */
export function eventsLinkingTo(items: TreeItem[], entityId: string): TreeItem[] {
  return items.filter(i => i.type === 'entity' && i.entityKind === 'event'
    && (i.references ?? []).some(r => r.targetId === entityId));
}

/** Facts whose source quote comes from one of the given binder items. */
export function factsCitingItems(b: Bible, itemIds: ReadonlySet<string>): Fact[] {
  return b.facts.filter(f => f.source !== undefined && itemIds.has(f.source.itemId));
}
