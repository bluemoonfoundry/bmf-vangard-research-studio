import type { ExtractRequest, ProviderId, RawConflict } from '@/ai/types';
import type { Bible, Fact, TreeItem } from '@/project/types';
import { ENTITY_KINDS } from '@/bible/entities';
import { attributeKey, formatValue, normalizeText } from '@/bible/normalize';
import type { ConflictFlag, ExtractionState } from '@/extraction/types';

/**
 * The semantic conflict check (llm:conflict-check): on demand, for one card or one kind, the AI is asked
 * for pairs of live facts that conflict in meaning, which the exact-value contradiction check can't
 * catch. Flags are advisory and never change a fact; a dismissed pair stays dismissed.
 */

/** Most facts one check sends; the writer is told when a scope has more. */
export const MAX_CHECK_FACTS = 300;
const CHARS_PER_TOKEN = 4;

export const CONFLICT_SYSTEM = [
  "You check a writer's story bible for facts that cannot all be true. The facts are grouped by entity,",
  'each with a ref like F3, a status (kept is canon, proposed is awaiting review), an attribute and a value.',
  '',
  'Report each pair of facts that conflict in meaning: for example "age: 24" against "born: 40 years before the',
  'story", or one character being both an only child and someone\'s sister. Facts about different entities can',
  'conflict too.',
  '',
  'Rules:',
  '- Only real contradictions. Not facts that merely differ, are vague, or could both be true with a little',
  '  explanation. When unsure, leave it out.',
  '- Skip pairs with the same entity and the same attribute name: those are already flagged.',
  '- An age written "N at year Y" means age N, Y years after the story begins.',
  '- reason: one short sentence saying why the two cannot both be true.',
  '- If nothing conflicts, return an empty list.',
].join('\n');

const oneLine = (s: string): string => s.replace(/\s+/g, ' ').trim();
export const factValueText = (v: Fact['value']): string => (typeof v === 'string' ? oneLine(v) : formatValue(v));
const kindName = (kind: string | null | undefined): string => (kind && ENTITY_KINDS.some(k => k.id === kind) ? kind : 'other');

/** Identifies a fact by what it says, so a dismissal holds across re-extraction and an edit lifts it. */
const factFingerprint = (f: Fact): string => [f.entityId, attributeKey(f.attribute), normalizeText(factValueText(f.value))].join('\u0000');

/** The same for either order of the pair. */
export function pairFingerprint(a: Fact, b: Fact): string {
  return [factFingerprint(a), factFingerprint(b)].sort().join('\u0001');
}

/** The live (not set-aside) facts of the scope's entities, kept before proposed, capped at MAX_CHECK_FACTS. */
export function checkFacts(bible: Bible, entityIds: readonly string[]): { facts: Fact[]; total: number } {
  const order = new Map(entityIds.map((id, i) => [id, i]));
  const live = bible.facts.filter(f => f.status !== 'set_aside' && order.has(f.entityId));
  const rank = (f: Fact) => (f.status === 'kept' ? 0 : 1);
  // Stable: within a status, the scope's entity order, then bible order.
  const sorted = [...live].sort((a, b) => rank(a) - rank(b) || order.get(a.entityId)! - order.get(b.entityId)!);
  return { facts: sorted.slice(0, MAX_CHECK_FACTS), total: live.length };
}

export interface ConflictRequestArgs {
  provider: ProviderId;
  model: string;
  items: readonly TreeItem[];
  facts: readonly Fact[];
}

/** The request text (facts under their entity, each with a ref) and the ref -> fact id map. */
export function buildConflictRequest(a: ConflictRequestArgs): { request: ExtractRequest; refs: Record<string, string> } {
  const byId = new Map(a.items.map(i => [i.id, i]));
  const refs: Record<string, string> = {};
  const groups = new Map<string, string[]>();
  a.facts.forEach((f, i) => {
    const ref = `F${i + 1}`;
    refs[ref] = f.id;
    groups.set(f.entityId, [...(groups.get(f.entityId) ?? []), `- ${ref} [${f.status}] ${oneLine(f.attribute)}: ${factValueText(f.value)}`]);
  });
  const sections = [...groups].map(([entityId, lines]) => {
    const e = byId.get(entityId);
    return [`## ${oneLine(e?.title ?? '') || 'Untitled'} (${kindName(e?.entityKind)})`, ...lines].join('\n');
  });
  return {
    request: { provider: a.provider, model: a.model, system: CONFLICT_SYSTEM, text: `# Facts\n\n${sections.join('\n\n')}` },
    refs,
  };
}

/** What the dialog shows before a check. */
export function estimateCheck(items: readonly TreeItem[], bible: Bible, entityIds: readonly string[]): { facts: number; total: number; tokens: number } {
  const { facts, total } = checkFacts(bible, entityIds);
  const { request } = buildConflictRequest({ provider: 'gemini', model: '', items, facts });
  return { facts: facts.length, total, tokens: Math.ceil((request.system.length + request.text.length) / CHARS_PER_TOKEN) };
}

export interface ApplyConflictArgs {
  extraction: ExtractionState;
  bible: Bible;
  /** The facts sent: earlier flags between two of them are replaced by this check's. */
  checkedFactIds: readonly string[];
  refs: Record<string, string>;
  conflicts: readonly RawConflict[];
  now: string;
  newId(): string;
}

/**
 * Turns a reply into flags. Skipped: unknown refs, a fact against itself, pairs with the same entity and
 * attribute (the exact contradiction check covers those), repeats, and dismissed pairs.
 */
export function applyConflictCheck(a: ApplyConflictArgs): { extraction: ExtractionState; added: number; dismissed: number } {
  const facts = new Map(a.bible.facts.map(f => [f.id, f]));
  const checked = new Set(a.checkedFactIds);
  const dismissedPrints = new Set((a.extraction.dismissedFlags ?? []).map(d => d.fingerprint));
  const kept = (a.extraction.flags ?? []).filter(f => !(checked.has(f.factIds[0]) && checked.has(f.factIds[1])));
  const seen = new Set(kept.map(f => f.fingerprint));
  const added: ConflictFlag[] = [];
  let dismissed = 0;
  for (const c of a.conflicts) {
    const x = facts.get(a.refs[c.a] ?? '');
    const y = facts.get(a.refs[c.b] ?? '');
    if (!x || !y || x.id === y.id) continue;
    if (x.entityId === y.entityId && attributeKey(x.attribute) === attributeKey(y.attribute)) continue;
    const fingerprint = pairFingerprint(x, y);
    if (seen.has(fingerprint)) continue;
    seen.add(fingerprint);
    if (dismissedPrints.has(fingerprint)) { dismissed++; continue; }
    added.push({ id: a.newId(), factIds: [x.id, y.id], reason: c.reason, fingerprint, at: a.now });
  }
  return { extraction: { ...a.extraction, flags: [...kept, ...added] }, added: added.length, dismissed };
}

export interface LiveFlag { flag: ConflictFlag; facts: [Fact, Fact] }

/**
 * Flags to show: both facts still exist, are live and unchanged since flagged, and the pair isn't
 * dismissed. With `entityId`, only flags involving that entity.
 */
export function liveFlags(bible: Bible, extraction: ExtractionState, entityId?: string): LiveFlag[] {
  const facts = new Map(bible.facts.map(f => [f.id, f]));
  const dismissed = new Set((extraction.dismissedFlags ?? []).map(d => d.fingerprint));
  return (extraction.flags ?? []).flatMap(flag => {
    const x = facts.get(flag.factIds[0]);
    const y = facts.get(flag.factIds[1]);
    if (!x || !y || x.status === 'set_aside' || y.status === 'set_aside') return [];
    if (pairFingerprint(x, y) !== flag.fingerprint || dismissed.has(flag.fingerprint)) return [];
    if (entityId && x.entityId !== entityId && y.entityId !== entityId) return [];
    return [{ flag, facts: [x, y] as [Fact, Fact] }];
  });
}

/** Live flags per entity id (a flag between two entities counts for both). */
export function flagCounts(bible: Bible, extraction: ExtractionState): Map<string, number> {
  const counts = new Map<string, number>();
  for (const { facts } of liveFlags(bible, extraction)) {
    for (const id of new Set(facts.map(f => f.entityId))) counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return counts;
}

/** Removes the flag and remembers its pair, so no later check raises it again. */
export function dismissFlag(extraction: ExtractionState, flag: ConflictFlag, bible: Bible, now: string): ExtractionState {
  const facts = flag.factIds.map(id => bible.facts.find(f => f.id === id));
  const label = facts.map(f => (f ? `${oneLine(f.attribute)}: ${factValueText(f.value)}` : 'deleted fact')).join(' / ');
  const dismissedFlags = (extraction.dismissedFlags ?? []).filter(d => d.fingerprint !== flag.fingerprint);
  return {
    ...extraction,
    flags: (extraction.flags ?? []).filter(f => f.id !== flag.id),
    dismissedFlags: [...dismissedFlags, { fingerprint: flag.fingerprint, label, at: now }],
  };
}
