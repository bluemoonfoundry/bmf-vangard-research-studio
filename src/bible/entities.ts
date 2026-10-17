import { CalendarClock, GitBranch, MapPin, Package, ScrollText, Shield, User, type LucideIcon } from 'lucide-react';
import type { EntityKind, TreeItem } from '@/project/types';

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

/** Strips a BOM and converts CRLF/CR line endings to LF, so stored offsets match what is shown. */
export function normalizeChatText(s: string): string {
  return s.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
}
