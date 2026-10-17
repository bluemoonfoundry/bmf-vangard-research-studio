import type { ItemType, LabelId, StatusId, TreeItem } from '@/project/types';

export interface ItemTypeInfo {
  id: ItemType;
  name: string;
}

/** Types the binder can create, in the order the "Add item" dialog offers them. */
export const ITEM_TYPES: ItemTypeInfo[] = [
  { id: 'document', name: 'Document' },
  { id: 'folder', name: 'Folder' },
  { id: 'image', name: 'Image' },
  { id: 'webpage', name: 'Web clip' },
  { id: 'audio', name: 'Audio' },
];

const KNOWN_TYPES = new Set<string>(ITEM_TYPES.map(t => t.id));

/** Unknown types (from a newer VRS, or a hand-edited tree) are shown as documents. */
export function itemType(item: Pick<TreeItem, 'type'>): ItemType {
  return KNOWN_TYPES.has(item.type) ? (item.type as ItemType) : 'document';
}

export interface LabelInfo {
  id: LabelId;
  name: string;
  /** Short name for chips and filters. */
  short: string;
  /** Used as an inline swatch color; readable on both themes. */
  color: string;
}

export const LABELS: Record<LabelId, LabelInfo> = {
  concept: { id: 'concept', name: 'Concept & idea', short: 'Concept', color: '#8b5cf6' },
  character: { id: 'character', name: 'Character', short: 'Character', color: '#3b82f6' },
  setting: { id: 'setting', name: 'Setting & world', short: 'Setting', color: '#10b981' },
  plot: { id: 'plot', name: 'Plot & timeline', short: 'Plot', color: '#f59e0b' },
  verified_fact: { id: 'verified_fact', name: 'Verified fact', short: 'Verified', color: '#06b6d4' },
  unverified: { id: 'unverified', name: 'Unverified / rumor', short: 'Unverified', color: '#ef4444' },
  primary_source: { id: 'primary_source', name: 'Primary source', short: 'Source', color: '#ec4899' },
  lore: { id: 'lore', name: 'Lore', short: 'Lore', color: '#d97706' },
};

export const LABEL_LIST = Object.values(LABELS);

export const STATUSES: Record<StatusId, string> = {
  to_read: 'To read',
  in_progress: 'In progress',
  notes_taken: 'Notes taken',
  incorporated: 'Incorporated',
  archived: 'Archived',
};

export const STATUS_LIST = Object.entries(STATUSES) as [StatusId, string][];

export const labelOf = (item: TreeItem): LabelInfo | null =>
  item.label && Object.hasOwn(LABELS, item.label) ? LABELS[item.label] : null;

export const statusName = (item: TreeItem): string | null =>
  item.status && Object.hasOwn(STATUSES, item.status) ? STATUSES[item.status] : null;

/** Neutral swatch for unlabeled items. */
export const NO_LABEL_COLOR = '#a8a29e';
