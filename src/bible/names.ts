import type { TreeItem } from '@/project/types';
import { entityKindOf } from '@/bible/entities';

/**
 * Characters who share a name word (a reused surname, a common first name), so the writer can tell
 * them apart. Titles split into words; honorifics, particles, placeholders and one-letter initials
 * don't count. Matching ignores case.
 */

const IGNORED = new Set([
  'the', 'of', 'a', 'an', 'and', 'mr', 'mrs', 'ms', 'miss', 'dr', 'sir', 'lady', 'lord', 'st', 'jr', 'sr',
  'de', 'da', 'di', 'du', 'van', 'von', 'der', 'den', 'le', 'la', 'del',
  // "New character" is what a fresh card is called until it's named.
  'new', 'character', 'untitled',
]);

/** The name words of a title as written, in order. */
function words(title: string): string[] {
  return (title.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) ?? [])
    .filter(w => w.length > 1 && !IGNORED.has(w.toLowerCase()));
}

/** A title's name words, lower-cased. */
export const nameParts = (title: string): string[] => words(title).map(w => w.toLowerCase());

export interface SharedName {
  /** The word as written in the given title. */
  part: string;
  others: TreeItem[];
}

/** Other characters sharing a name word with `title` (one entry per shared word, in title order). */
export function sharedNames(title: string, items: readonly TreeItem[], excludeId?: string): SharedName[] {
  const characters = items.filter(i => i.type === 'entity' && entityKindOf(i) === 'character' && i.id !== excludeId)
    .map(i => ({ item: i, parts: new Set(nameParts(i.title)) }));
  const out: SharedName[] = [];
  const seen = new Set<string>();
  for (const word of words(title)) {
    const key = word.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const others = characters.filter(c => c.parts.has(key)).map(c => c.item);
    if (others.length) out.push({ part: word, others });
  }
  return out;
}

const titleOf = (i: TreeItem) => i.title || 'Untitled';

export const sharedNamesText = (shared: SharedName[]): string[] =>
  shared.map(s => `Shares "${s.part}" with ${s.others.map(titleOf).join(', ')}`);
