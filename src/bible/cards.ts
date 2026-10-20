import type { Bible, EntityKind, Fact, TreeItem } from '@/project/types';
import type { Contradiction, Version } from '@/bible/contradictions';
import { groupVersions } from '@/bible/contradictions';
import { ENTITY_KINDS, entityKindOf } from '@/bible/entities';
import { attributeKey, isDatedAge } from '@/bible/normalize';
import { startAgeText } from '@/bible/ages';

/** Card wall logic: which facts a card shows, its counts, and what is linked to it. */

export type WallTabId = EntityKind | 'other';

export interface WallTab { id: WallTabId; name: string; entities: TreeItem[] }

const PLURAL: Record<EntityKind, string> = {
  character: 'Characters', location: 'Locations', faction: 'Factions', item: 'Items',
  lore: 'Lore', event: 'Events', plotline: 'Plotlines',
};

const byTitle = (a: TreeItem, b: TreeItem) => (a.title || '').localeCompare(b.title || '', undefined, { sensitivity: 'base' });

/** A tab per known kind (always shown), plus "Other" for entities of an unknown kind when there are any. */
export function wallTabs(items: readonly TreeItem[]): WallTab[] {
  const entities = items.filter(i => i.type === 'entity');
  const tabs: WallTab[] = ENTITY_KINDS.map(k => ({
    id: k.id, name: PLURAL[k.id], entities: entities.filter(e => entityKindOf(e) === k.id).sort(byTitle),
  }));
  const other = entities.filter(e => entityKindOf(e) === null).sort(byTitle);
  if (other.length) tabs.push({ id: 'other', name: 'Other', entities: other });
  return tabs;
}

/** Attribute order for cards nobody pinned facts on; attributes not listed follow in the order they were added. */
export const DEFAULT_CARD_ORDER: Record<EntityKind, string[]> = {
  character: ['role', 'age', 'appearance', 'personality', 'occupation', 'origin', 'affiliation'],
  location: ['type', 'region', 'climate', 'population', 'ruler'],
  faction: ['type', 'leader', 'goal', 'base', 'members'],
  item: ['type', 'owner', 'power', 'origin'],
  lore: ['type', 'summary', 'origin'],
  event: ['when', 'location', 'participants', 'outcome'],
  plotline: ['premise', 'status', 'stakes'],
};

export const CARD_FACT_LIMIT = 5;

export interface CanonVersion extends Version {
  /** Distinct source items among the facts that agree on this value. */
  sourceCount: number;
  /** How a group of dated ages reads ("6 at the start"); absent for other values. */
  label?: string;
}

export interface CanonLine {
  attribute: string;
  key: string;
  /** One version normally; several when the writer kept all of a contradiction. */
  versions: CanonVersion[];
  pinned: boolean;
}

/** The distinct items a fact came from: its extraction evidence, else its captured source. */
export const sourceItemsOf = (f: Fact): string[] =>
  [...new Set(f.evidence?.length ? f.evidence.map(e => e.source.itemId) : f.source ? [f.source.itemId] : [])];

export const sourceCount = (facts: readonly Fact[]): number => new Set(facts.flatMap(sourceItemsOf)).size;

const pinsOf = (entity: TreeItem): string[] =>
  (Array.isArray(entity.cardFacts) ? entity.cardFacts.filter((k): k is string => typeof k === 'string') : []);

/** Kept facts, one line per attribute: pinned first (in pin order), then the kind's default order, then the rest. */
export function canonLines(bible: Bible, entity: TreeItem): CanonLine[] {
  const groups = new Map<string, Fact[]>();
  for (const f of bible.facts) {
    if (f.entityId !== entity.id || f.status !== 'kept') continue;
    const key = attributeKey(f.attribute);
    groups.set(key, [...(groups.get(key) ?? []), f]);
  }
  const pins = pinsOf(entity);
  const kind = entityKindOf(entity);
  const defaults = kind ? DEFAULT_CARD_ORDER[kind] : [];
  const rank = (key: string, added: number) => {
    const pin = pins.indexOf(key);
    if (pin !== -1) return pin;
    const d = defaults.indexOf(key);
    return d !== -1 ? pins.length + d : pins.length + defaults.length + added;
  };
  return [...groups.entries()]
    .map(([key, facts], added) => ({
      line: {
        attribute: facts[0].attribute.trim(),
        key,
        versions: groupVersions(facts).map(v => ({
          ...v,
          sourceCount: sourceCount(v.facts),
          ...(isDatedAge(v.value) && { label: startAgeText(v.facts.map(f => f.value).filter(isDatedAge)) }),
        })),
        pinned: pins.includes(key),
      },
      rank: rank(key, added),
    }))
    .sort((a, b) => a.rank - b.rank)
    .map(x => x.line);
}

/** What a card on the wall shows: the pinned lines, or the first few canon lines when none are pinned. */
export function cardLines(bible: Bible, entity: TreeItem, limit = CARD_FACT_LIMIT): CanonLine[] {
  const lines = canonLines(bible, entity);
  const pinned = lines.filter(l => l.pinned);
  return (pinned.length ? pinned : lines).slice(0, limit);
}

/** The entity's `cardFacts` with this attribute pinned, or unpinned if it was. */
export function togglePin(entity: TreeItem, attribute: string): string[] {
  const key = attributeKey(attribute);
  const pins = pinsOf(entity);
  return pins.includes(key) ? pins.filter(k => k !== key) : [...pins, key];
}

export interface CardStats { kept: number; proposed: number; openConflicts: number; sources: number }

/** Counts for a card's badges. `open` is the project's open contradictions. */
export function cardStats(bible: Bible, entityId: string, open: readonly Contradiction[]): CardStats {
  const facts = bible.facts.filter(f => f.entityId === entityId);
  const live = facts.filter(f => f.status !== 'set_aside');
  return {
    kept: facts.filter(f => f.status === 'kept').length,
    proposed: facts.filter(f => f.status === 'proposed').length,
    openConflicts: open.filter(c => c.entityId === entityId).length,
    sources: sourceCount(live),
  };
}

/** The distinct items the entity's facts were captured from, first seen first, with how many facts each gave. */
export function cameFrom(bible: Bible, entityId: string): { itemId: string; facts: number }[] {
  const counts = new Map<string, number>();
  for (const f of bible.facts) {
    if (f.entityId !== entityId) continue;
    for (const itemId of sourceItemsOf(f)) counts.set(itemId, (counts.get(itemId) ?? 0) + 1);
  }
  return [...counts].map(([itemId, facts]) => ({ itemId, facts }));
}

export interface LinkedItems { images: TreeItem[]; audio: TreeItem[]; related: TreeItem[]; other: TreeItem[] }

/** The entity's references, sorted by what they point at. References to deleted items are skipped. */
export function linkedItems(entity: TreeItem, byId: ReadonlyMap<string, TreeItem>): LinkedItems {
  const out: LinkedItems = { images: [], audio: [], related: [], other: [] };
  for (const r of entity.references ?? []) {
    const target = byId.get(r.targetId);
    if (!target) continue;
    if (target.type === 'image') out.images.push(target);
    else if (target.type === 'audio') out.audio.push(target);
    else if (target.type === 'entity') out.related.push(target);
    else out.other.push(target);
  }
  return out;
}

const hasImage = (i: TreeItem | undefined): i is TreeItem => i?.type === 'image' && typeof i.asset === 'string';

/** The chosen portrait (`portraitId`), else the first linked image that has a file. */
export function portraitOf(entity: TreeItem, byId: ReadonlyMap<string, TreeItem>): TreeItem | undefined {
  const chosen = typeof entity.portraitId === 'string' ? byId.get(entity.portraitId) : undefined;
  if (hasImage(chosen)) return chosen;
  return linkedItems(entity, byId).images.find(hasImage);
}
