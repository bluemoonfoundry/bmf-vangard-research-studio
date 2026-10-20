import type { Bible, TreeItem } from '@/project/types';
import type { Canon } from '@/extraction/types';
import { attributeKey, isAgeAttribute, isDatedAge, isWhenAttribute } from '@/bible/normalize';

/**
 * Renaming an attribute, on one entity or every entity. Renaming into a name the entity already uses
 * merges the two, so differing values meet in one contradiction. Everything keyed by the attribute
 * follows: decisions, pending proposals, stored rejections, conflict-check flags and dismissals, and
 * card pins (renamedPins, applied to the tree separately).
 */

export interface RenameArgs {
  from: string;
  to: string;
  /** The entities to rename on; null renames everywhere (pending proposals for new cards included). */
  entityIds: ReadonlySet<string> | null;
}

const inScope = (entityIds: ReadonlySet<string> | null, id: string) => entityIds === null || entityIds.has(id);

/** Why the rename can't happen, or null. */
export function renameCheck(bible: Bible, from: string, to: string, entityIds: ReadonlySet<string> | null): string | null {
  if (!to.trim()) return 'Enter a new name.';
  if (isWhenAttribute(from)) return '"when" holds story positions and can\'t be renamed.';
  if (isWhenAttribute(to)) return '"when" holds story positions; choose another name.';
  if (isAgeAttribute(from) && !isAgeAttribute(to)
    && bible.facts.some(f => inScope(entityIds, f.entityId) && isAgeAttribute(f.attribute) && isDatedAge(f.value))) {
    return 'Ages with a year must stay under "age".';
  }
  return null;
}

/** How many facts, on how many entities, the rename would change. */
export function renameCounts(bible: Bible, from: string, entityIds: ReadonlySet<string> | null): { facts: number; entities: number } {
  const key = attributeKey(from);
  const hits = bible.facts.filter(f => inScope(entityIds, f.entityId) && attributeKey(f.attribute) === key);
  return { facts: hits.length, entities: new Set(hits.map(f => f.entityId)).size };
}

/**
 * Rewrites the attribute part of a value fingerprint (`entity\0attribute\0value`, see
 * src/extraction/apply.ts and conflictCheck.ts) so rejections and dismissals still match.
 */
function renamePrint(print: string, fromKey: string, toKey: string, entityIds: ReadonlySet<string> | null): string {
  const parts = print.split('\u0000');
  if (parts.length !== 3 || parts[1] !== fromKey || !inScope(entityIds, parts[0])) return print;
  return [parts[0], toKey, parts[2]].join('\u0000');
}

/** The same for a pair fingerprint (two value fingerprints, sorted, joined by \u0001). */
const renamePair = (print: string, fromKey: string, toKey: string, entityIds: ReadonlySet<string> | null): string =>
  print.split('\u0001').map(p => renamePrint(p, fromKey, toKey, entityIds)).sort().join('\u0001');

export function renameAttribute(canon: Canon, { from, to, entityIds }: RenameArgs, now: string): Canon {
  const fromKey = attributeKey(from);
  const name = to.trim();
  const toKey = attributeKey(name);
  const matches = (attribute: string, entityId: string) => attributeKey(attribute) === fromKey && inScope(entityIds, entityId);
  if (!canon.bible.facts.some(f => matches(f.attribute, f.entityId))
    && !canon.extraction.pending.some(p => attributeKey(p.attribute) === fromKey)) return canon;

  const { bible, extraction } = canon;
  return {
    bible: {
      ...bible,
      facts: bible.facts.map(f => (matches(f.attribute, f.entityId) ? { ...f, attribute: name, updatedAt: now } : f)),
      decisions: bible.decisions.map(d => (matches(d.attribute, d.entityId) ? { ...d, attribute: name } : d)),
    },
    extraction: {
      ...extraction,
      pending: extraction.pending.map(p => {
        const inRange = 'entityId' in p.ref ? inScope(entityIds, p.ref.entityId) : entityIds === null;
        return inRange && attributeKey(p.attribute) === fromKey ? { ...p, attribute: name } : p;
      }),
      rejections: extraction.rejections.map(r => ({ ...r, fingerprint: renamePrint(r.fingerprint, fromKey, toKey, entityIds) })),
      ...(extraction.flags && {
        flags: extraction.flags.map(fl => ({ ...fl, fingerprint: renamePair(fl.fingerprint, fromKey, toKey, entityIds) })),
      }),
      ...(extraction.dismissedFlags && {
        dismissedFlags: extraction.dismissedFlags.map(d => ({ ...d, fingerprint: renamePair(d.fingerprint, fromKey, toKey, entityIds) })),
      }),
    },
  };
}

/** The card pins (`cardFacts`) that change: the key renamed in place, a resulting duplicate dropped. */
export function renamedPins(items: readonly TreeItem[], from: string, to: string, entityIds: ReadonlySet<string> | null):
  { id: string; cardFacts: string[] }[] {
  const fromKey = attributeKey(from);
  const toKey = attributeKey(to);
  const out: { id: string; cardFacts: string[] }[] = [];
  for (const item of items) {
    if (!Array.isArray(item.cardFacts) || !inScope(entityIds, item.id)) continue;
    const pins = item.cardFacts.filter((k): k is string => typeof k === 'string');
    if (!pins.includes(fromKey)) continue;
    out.push({ id: item.id, cardFacts: [...new Set(pins.map(k => (k === fromKey ? toKey : k)))] });
  }
  return out;
}
