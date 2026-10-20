import type { Bible, Fact, TreeItem } from '@/project/types';
import { formatValue } from '@/bible/normalize';
import type { Canon, EntityRef, ExtractionState, PendingCard, PendingProposal } from '@/extraction/types';
import { AI_ORIGIN, cardFingerprint, entityKeyOf, fingerprint } from '@/extraction/apply';

export { pruneExtraction } from '@/extraction/prune';

/**
 * Review-queue state changes for AI extraction, as `Canon -> Canon` functions. Pure: no React, no IPC.
 * Setting aside a proposed fact needs nothing here: a fact set aside by hand is itself the rejection.
 */

export interface ReviewGroup {
  /** The entity id, or the pending card id. */
  key: string;
  entity?: TreeItem;
  card?: PendingCard;
  /** AI-extracted facts still to review. */
  facts: Fact[];
  /** Suggestions, and every proposal for a new card. */
  pending: PendingProposal[];
}

const titleOrder = (a: TreeItem, b: TreeItem) => (a.title || '').localeCompare(b.title || '', undefined, { sensitivity: 'base' });
const valueText = formatValue;
const isAiProposal = (f: Fact) => f.status === 'proposed' && f.origin === AI_ORIGIN;

/** What the review queue shows: per entity (by title), then per new card (oldest first). */
export function reviewGroups(items: TreeItem[], bible: Bible, extraction: ExtractionState): ReviewGroup[] {
  const entities = items.filter(i => i.type === 'entity').sort(titleOrder);
  const groups: ReviewGroup[] = [];
  for (const entity of entities) {
    const facts = bible.facts.filter(f => f.entityId === entity.id && isAiProposal(f));
    const pending = extraction.pending.filter(p => 'entityId' in p.ref && p.ref.entityId === entity.id);
    if (facts.length || pending.length) groups.push({ key: entity.id, entity, facts, pending });
  }
  for (const card of extraction.cards) {
    groups.push({ key: card.id, card, facts: [], pending: extraction.pending.filter(p => 'cardId' in p.ref && p.ref.cardId === card.id) });
  }
  return groups;
}

/** Things waiting in the queue: AI proposed facts plus pending proposals. */
export function reviewCount(items: TreeItem[], bible: Bible, extraction: ExtractionState): number {
  return reviewGroups(items, bible, extraction).reduce((n, g) => n + g.facts.length + g.pending.length, 0);
}

const newFact = (entityId: string, p: PendingProposal, now: string, id: string): Fact => ({
  id, entityId, attribute: p.attribute, value: p.value, status: 'proposed', origin: AI_ORIGIN,
  ...(p.evidence[0] && { source: p.evidence[0].source }), evidence: p.evidence,
  ...(p.replaces && { replaces: p.replaces }), createdAt: now, updatedAt: now,
});

const cardKey = (card: PendingCard) => entityKeyOf({ kind: card.kind, title: card.title });

function refKey(x: ExtractionState, ref: EntityRef): string | null {
  if ('entityId' in ref) return ref.entityId;
  const card = x.cards.find(c => c.id === ref.cardId);
  return card ? cardKey(card) : null;
}

/**
 * The card is now entity `entityId` (the caller created the binder item). Its said and built_on
 * proposals become proposed facts; its suggestions stay pending, on the entity; rejections recorded
 * against the card follow it.
 */
export function approveCard(c: Canon, cardId: string, entityId: string, now: string, newId: () => string): Canon {
  const card = c.extraction.cards.find(x => x.id === cardId);
  if (!card) return c;
  const mine = (p: PendingProposal) => 'cardId' in p.ref && p.ref.cardId === cardId;
  const adopted = c.extraction.pending.filter(p => mine(p) && p.strength !== 'suggested');
  const prefix = `${cardKey(card)}\u0000`;
  return {
    bible: adopted.length ? { ...c.bible, facts: [...c.bible.facts, ...adopted.map(p => newFact(entityId, p, now, newId()))] } : c.bible,
    extraction: {
      ...c.extraction,
      cards: c.extraction.cards.filter(x => x.id !== cardId),
      pending: c.extraction.pending
        .filter(p => !(mine(p) && p.strength !== 'suggested'))
        .map(p => (mine(p) ? { ...p, ref: { entityId } } : p)),
      rejections: c.extraction.rejections.map(r => (r.fingerprint.startsWith(prefix)
        ? { ...r, fingerprint: `${entityId}\u0000${r.fingerprint.slice(prefix.length)}` }
        : r)),
    },
  };
}

/** A sticky no: the card and everything proposed for it go, and re-runs won't propose it again. */
export function rejectCard(c: Canon, cardId: string, now: string): Canon {
  const card = c.extraction.cards.find(x => x.id === cardId);
  if (!card) return c;
  return {
    bible: c.bible,
    extraction: {
      ...c.extraction,
      cards: c.extraction.cards.filter(x => x.id !== cardId),
      pending: c.extraction.pending.filter(p => !('cardId' in p.ref && p.ref.cardId === cardId)),
      rejections: [...c.extraction.rejections, { fingerprint: cardFingerprint(card.kind, card.title), label: `New card: ${card.title}`, at: now }],
    },
  };
}

/** A suggestion on an existing entity becomes a proposed fact (new cards' proposals wait for approval). */
export function promote(c: Canon, pendingId: string, now: string, newId: () => string): Canon {
  const p = c.extraction.pending.find(x => x.id === pendingId);
  if (!p || !('entityId' in p.ref)) return c;
  return {
    bible: { ...c.bible, facts: [...c.bible.facts, newFact(p.ref.entityId, p, now, newId())] },
    extraction: { ...c.extraction, pending: c.extraction.pending.filter(x => x.id !== pendingId) },
  };
}

/** A sticky no to one pending proposal. */
export function dismiss(c: Canon, pendingId: string, now: string): Canon {
  const p = c.extraction.pending.find(x => x.id === pendingId);
  const key = p && refKey(c.extraction, p.ref);
  if (!p || !key) return c;
  return {
    bible: c.bible,
    extraction: {
      ...c.extraction,
      pending: c.extraction.pending.filter(x => x.id !== pendingId),
      rejections: [...c.extraction.rejections, { fingerprint: fingerprint(key, p.attribute, p.value), label: `${p.attribute}: ${valueText(p.value)}`, at: now }],
    },
  };
}

export interface RejectionRow { fingerprint: string; label: string; factId?: string }

/** The entity's rejections: facts set aside by hand (not by a decision), then stored ones. */
export function rejectionsFor(entity: TreeItem, bible: Bible, extraction: ExtractionState): RejectionRow[] {
  const decided = new Set(bible.decisions.flatMap(d => d.setAsideIds));
  const rows: RejectionRow[] = bible.facts
    .filter(f => f.entityId === entity.id && f.status === 'set_aside' && !decided.has(f.id))
    .map(f => ({ fingerprint: fingerprint(f.entityId, f.attribute, f.value), label: `${f.attribute}: ${valueText(f.value)}`, factId: f.id }));
  const prefix = `${entity.id}\u0000`;
  for (const r of extraction.rejections) if (r.fingerprint.startsWith(prefix)) rows.push({ fingerprint: r.fingerprint, label: r.label });
  return rows;
}

/** Lifts a rejection: a stored one is forgotten; a set-aside fact goes back to review. */
export function liftRejection(c: Canon, print: string, now: string): Canon {
  const decided = new Set(c.bible.decisions.flatMap(d => d.setAsideIds));
  const matches = (f: Fact) => f.status === 'set_aside' && !decided.has(f.id) && fingerprint(f.entityId, f.attribute, f.value) === print;
  const bible = c.bible.facts.some(matches)
    ? { ...c.bible, facts: c.bible.facts.map(f => (matches(f) ? { ...f, status: 'proposed' as const, updatedAt: now } : f)) }
    : c.bible;
  const rejections = c.extraction.rejections.filter(r => r.fingerprint !== print);
  const extraction = rejections.length === c.extraction.rejections.length ? c.extraction : { ...c.extraction, rejections };
  return bible === c.bible && extraction === c.extraction ? c : { bible, extraction };
}
