import type { RawProposal, Strength } from '@/ai/types';
import type { Bible, EntityKind, Evidence, Fact, FactSource, StoryPosition, TreeItem } from '@/project/types';
import { attributeKey, isWhenAttribute, normalizeText, positionsCompatible } from '@/bible/normalize';
import { ENTITY_KINDS, entityKindOf } from '@/bible/entities';
import type { EntityRef, ExtractionState, PendingCard, PendingProposal } from '@/extraction/types';
import { locateEvidence, type ExtractionSource } from '@/extraction/sourceText';

/**
 * Turns validated extraction results into bible and extraction state. Results are matched against
 * the current canon every time they're applied (cached runs included), and applying the same
 * results again changes nothing: evidence and pending proposals merge instead of repeating.
 *
 * - said / built_on on an existing entity -> a `proposed` fact (origin "ai"), or more evidence on a
 *   live fact that agrees; suggested -> the pending pile; anything about an unknown entity -> a
 *   pending new card. Nothing becomes canon here.
 * - Rejected fingerprints are skipped. A value set aside by a keep-one decision is not a rejection,
 *   but evidence the writer already decided on doesn't bring it back; only new evidence does.
 */

export const AI_ORIGIN = 'ai';

export const entityKeyOf = (ref: { entityId: string } | { kind: string; title: string }): string =>
  ('entityId' in ref ? ref.entityId : `new:${ref.kind}:${normalizeText(ref.title)}`);

const valueKey = (v: string | StoryPosition): string =>
  (typeof v === 'string' ? normalizeText(v) : `@${v.season}.${v.episode ?? ''}.${v.order ?? ''}`);

/** What a rejection remembers: the entity (or proposed card), the attribute and the value, normalized. */
export const fingerprint = (entityKey: string, attribute: string, value: string | StoryPosition): string =>
  [entityKey, attributeKey(attribute), valueKey(value)].join('\u0000');

/** A rejected new card: its kind and normalized title, with no attribute or value. */
export const cardFingerprint = (kind: string, title: string): string => fingerprint(entityKeyOf({ kind, title }), '', '');

/** Stored rejections, plus every fact the writer set aside by hand (not through a decision). */
export function rejectedFingerprints(bible: Bible, extraction: ExtractionState): Set<string> {
  const decided = new Set(bible.decisions.flatMap(d => d.setAsideIds));
  const out = new Set(extraction.rejections.map(r => r.fingerprint));
  for (const f of bible.facts) {
    if (f.status === 'set_aside' && !decided.has(f.id)) out.add(fingerprint(f.entityId, f.attribute, f.value));
  }
  return out;
}

/** "Season 2, episode 3, order 1" or "S2 E3 #1"; null when there is no season of 1 or more. */
export function parseWhen(text: string): StoryPosition | null {
  const t = text.toLowerCase();
  const num = (re: RegExp) => { const m = re.exec(t); return m ? Number(m[1]) : undefined; };
  const season = num(/(?:season|\bs)\s*(\d+)/);
  if (season === undefined || season < 1) return null;
  const episode = num(/(?:episode|\be|\bep)\s*(\d+)/);
  const order = num(/(?:order|#)\s*(-?\d+(?:\.\d+)?)/);
  return {
    season,
    ...(episode !== undefined && episode >= 1 && { episode }),
    ...(order !== undefined && { order }),
  };
}

const agrees = (a: Fact['value'], b: Fact['value']): boolean =>
  (typeof a === 'string' && typeof b === 'string'
    ? normalizeText(a) === normalizeText(b)
    : typeof a === 'object' && typeof b === 'object' && positionsCompatible(a, b));

const sourceKey = (s: FactSource) => `${s.itemId}|${s.messageId ?? ''}|${s.start}|${s.end}`;

/** `into` plus the evidence it doesn't have yet. */
function mergeEvidence(into: readonly Evidence[], add: readonly Evidence[]): Evidence[] {
  const seen = new Set(into.map(e => sourceKey(e.source)));
  const out = [...into];
  for (const e of add) {
    if (seen.has(sourceKey(e.source))) continue;
    seen.add(sourceKey(e.source));
    out.push(e);
  }
  return out;
}

const evidenceOf = (f: Fact): Evidence[] => f.evidence ?? (f.source ? [{ source: f.source, strength: 'said' }] : []);

const KNOWN_KINDS = new Set<string>(ENTITY_KINDS.map(k => k.id));

export interface ApplyContext {
  items: TreeItem[];
  bible: Bible;
  extraction: ExtractionState;
  source: ExtractionSource;
  now: string;
  newId(): string;
}

export interface ApplySummary {
  /** New proposed facts and new card proposals' facts. */
  facts: number;
  /** Proposals that only added evidence to something already there. */
  merged: number;
  suggested: number;
  cards: number;
  /** Rejected or already decided. */
  skipped: number;
  /** Unusable: no quote found, or an unreadable `when`. */
  dropped: number;
}

/** The strength the evidence supports. */
function strengthFor(claimed: Strength, located: { turn: { role: string } }[], src: ExtractionSource): Strength {
  if (src.item.ownWriting === true) return 'said';
  if (!src.hasTurns) return 'suggested';
  if (claimed !== 'suggested' && !located.some(l => l.turn.role === 'user')) return 'suggested';
  return claimed;
}

export function applyResults(ctx: ApplyContext, proposals: RawProposal[]): { bible: Bible; extraction: ExtractionState; summary: ApplySummary } {
  const { items, source: src, now, newId } = ctx;
  const summary: ApplySummary = { facts: 0, merged: 0, suggested: 0, cards: 0, skipped: 0, dropped: 0 };
  const facts = [...ctx.bible.facts];
  const cards = [...ctx.extraction.cards];
  const pending = [...ctx.extraction.pending];
  const rejected = rejectedFingerprints(ctx.bible, ctx.extraction);
  const entities = items.filter(i => i.type === 'entity');
  const kindOf = (e: TreeItem) => entityKindOf(e) ?? e.entityKind;

  const resolve = (p: RawProposal): EntityRef | null => {
    const byId = entities.find(e => e.id === p.entity.id);
    if (byId) return { entityId: byId.id };
    const name = normalizeText(p.entity.name);
    if (!name) return null;
    const named = entities.filter(e => normalizeText(e.title) === name);
    const match = named.find(e => kindOf(e) === p.entity.kind) ?? named[0];
    if (match) return { entityId: match.id };
    const card = cards.find(c => c.kind === p.entity.kind && normalizeText(c.title) === name);
    if (card) return { cardId: card.id };
    if (!KNOWN_KINDS.has(p.entity.kind) || rejected.has(cardFingerprint(p.entity.kind, p.entity.name))) return null;
    const fresh: PendingCard = { id: newId(), kind: p.entity.kind as EntityKind, title: p.entity.name.trim(), reason: p.entity.reason, createdAt: now };
    cards.push(fresh);
    summary.cards++;
    return { cardId: fresh.id };
  };

  const keyOf = (ref: EntityRef): string => {
    if ('entityId' in ref) return ref.entityId;
    const card = cards.find(c => c.id === ref.cardId)!;
    return entityKeyOf({ kind: card.kind, title: card.title });
  };
  const sameRef = (a: EntityRef, b: EntityRef) =>
    ('entityId' in a && 'entityId' in b && a.entityId === b.entityId) || ('cardId' in a && 'cardId' in b && a.cardId === b.cardId);

  for (const p of proposals) {
    const value = isWhenAttribute(p.attribute) ? parseWhen(p.value) : p.value;
    const located = p.evidence.flatMap(e => locateEvidence(src, e.quote, e.turn) ?? []);
    if (value === null || !located.length) { summary.dropped++; continue; }
    const strength = strengthFor(p.strength, located, src);
    const evidence = mergeEvidence([], located.map(l => ({ source: l.source, strength })));

    const ref = resolve(p);
    if (!ref) { summary.skipped++; continue; }
    const fp = fingerprint(keyOf(ref), p.attribute, value);
    if (rejected.has(fp)) { summary.skipped++; continue; }
    const extra = p.replaces ? { replaces: p.replaces } : {};

    if ('entityId' in ref) {
      const same = (f: Fact) => f.entityId === ref.entityId && attributeKey(f.attribute) === attributeKey(p.attribute) && agrees(f.value, value);
      const live = facts.findIndex(f => f.status !== 'set_aside' && same(f));
      if (live >= 0) {
        const merged = mergeEvidence(evidenceOf(facts[live]), evidence);
        if (merged.length > evidenceOf(facts[live]).length) {
          facts[live] = { ...facts[live], evidence: merged, updatedAt: now };
          summary.merged++;
        }
        continue;
      }
      const aside = facts.find(f => f.status === 'set_aside' && same(f));
      if (aside) {
        const known = new Set(evidenceOf(aside).map(e => sourceKey(e.source)));
        if (evidence.every(e => known.has(sourceKey(e.source)))) { summary.skipped++; continue; }
      }
    }

    const waiting = pending.findIndex(x => sameRef(x.ref, ref) && fingerprint(keyOf(x.ref), x.attribute, x.value) === fp);
    if ('entityId' in ref && strength !== 'suggested') {
      // A writer turn now backs it: it becomes a proposed fact, taking along any pending suggestion's evidence.
      const carried = waiting >= 0 ? pending.splice(waiting, 1)[0].evidence : [];
      const all = mergeEvidence(evidence, carried);
      facts.push({
        id: newId(), entityId: ref.entityId, attribute: p.attribute, value, status: 'proposed', origin: AI_ORIGIN,
        source: all[0].source, evidence: all, ...extra, createdAt: now, updatedAt: now,
      });
      summary.facts++;
      continue;
    }
    if (waiting >= 0) {
      const merged = mergeEvidence(pending[waiting].evidence, evidence);
      if (merged.length > pending[waiting].evidence.length) {
        pending[waiting] = { ...pending[waiting], evidence: merged };
        summary.merged++;
      }
      continue;
    }
    const entry: PendingProposal = { id: newId(), ref, attribute: p.attribute, value, strength, evidence, ...extra, createdAt: now };
    pending.push(entry);
    if (strength === 'suggested') summary.suggested++;
    else summary.facts++;
  }

  const bible = JSON.stringify(facts) === JSON.stringify(ctx.bible.facts) ? ctx.bible : { ...ctx.bible, facts };
  const unchanged = JSON.stringify(cards) === JSON.stringify(ctx.extraction.cards)
    && JSON.stringify(pending) === JSON.stringify(ctx.extraction.pending);
  const extraction = unchanged ? ctx.extraction : { ...ctx.extraction, cards, pending };
  return { bible, extraction, summary };
}
