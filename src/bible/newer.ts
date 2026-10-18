import type { Fact } from '@/project/types';
import type { Contradiction } from '@/bible/contradictions';

/**
 * "Keep the newer": the version of a contradiction whose latest evidence sits furthest down the
 * source order (oldest first; sources missing from it count as oldest). Only a suggestion, never
 * applied on its own. Null when there is no clear newer version: a tie, no sources, or every version
 * from the same single source (within one source the later wording already replaces the earlier).
 */
export function newerVersion(c: Contradiction, order: readonly string[]): number | null {
  const rank = new Map(order.map((id, i) => [id, i]));
  const itemsOf = (f: Fact) => [...(f.evidence ?? []).map(e => e.source.itemId), ...(f.source ? [f.source.itemId] : [])];
  const all = new Set(c.versions.flatMap(v => v.facts.flatMap(itemsOf)));
  if (all.size < 2) return null;
  const latest = c.versions.map(v => Math.max(...v.facts.flatMap(itemsOf).map(id => rank.get(id) ?? -1), Number.NEGATIVE_INFINITY));
  const best = Math.max(...latest);
  if (best === Number.NEGATIVE_INFINITY || latest.filter(x => x === best).length > 1) return null;
  return latest.indexOf(best);
}
