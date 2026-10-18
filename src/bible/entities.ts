import { CalendarClock, GitBranch, MapPin, Package, ScrollText, Shield, User, type LucideIcon } from 'lucide-react';
import type { Bible, EntityKind, TreeItem } from '@/project/types';
import { attributeKey, isWhenAttribute, WHEN } from '@/bible/normalize';

export interface EntityKindInfo {
  id: EntityKind;
  name: string;
  icon: LucideIcon;
}

export const ENTITY_KINDS: EntityKindInfo[] = [
  { id: 'character', name: 'Character', icon: User },
  { id: 'location', name: 'Location', icon: MapPin },
  { id: 'faction', name: 'Faction', icon: Shield },
  { id: 'item', name: 'Item', icon: Package },
  { id: 'lore', name: 'Lore', icon: ScrollText },
  { id: 'event', name: 'Event', icon: CalendarClock },
  { id: 'plotline', name: 'Plotline', icon: GitBranch },
];

const KNOWN_KINDS = new Set<string>(ENTITY_KINDS.map(k => k.id));

/** The known kind of an entity item, or null (other items, or an unknown kind from a newer VRS). */
export function entityKindOf(item: Pick<TreeItem, 'type' | 'entityKind'>): EntityKind | null {
  return item.type === 'entity' && item.entityKind && KNOWN_KINDS.has(item.entityKind) ? (item.entityKind as EntityKind) : null;
}

export const isEvent = (item: Pick<TreeItem, 'type' | 'entityKind'>): boolean => entityKindOf(item) === 'event';

/** Strips a BOM and converts CRLF/CR line endings to LF, so stored offsets match what is shown (chats and documents). */
export function normalizeChatText(s: string): string {
  return s.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
}

/**
 * Attributes already used on entities of this kind, most used first, plus `when` for events.
 * With no kind (a new, unchosen entity) every entity counts.
 */
export function attributeSuggestions(b: Bible, items: TreeItem[], kind: EntityKind | null): string[] {
  const ids = new Set(items.filter(i => i.type === 'entity' && (kind === null || entityKindOf(i) === kind)).map(i => i.id));
  const counts = new Map<string, { label: string; n: number }>();
  for (const f of b.facts) {
    if (!ids.has(f.entityId)) continue;
    const key = attributeKey(f.attribute);
    const hit = counts.get(key);
    if (hit) hit.n++;
    else counts.set(key, { label: f.attribute.trim(), n: 1 });
  }
  const out = [...counts.values()].sort((a, b) => b.n - a.n).map(c => c.label);
  if (kind === 'event' && !out.some(a => isWhenAttribute(a))) out.push(WHEN);
  return out;
}
