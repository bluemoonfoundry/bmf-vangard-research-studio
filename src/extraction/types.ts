import type { ProviderId, RawProposal, Strength } from '@/ai/types';
import type { EntityKind, Evidence, StoryPosition } from '@/project/types';

/**
 * Shapes of bible/extraction.json (validated by normalizeExtraction in electron/lib/projectSchema.js).
 * Proposals that are not yet bible facts live here: suggestions on existing entities, and everything
 * proposed for a new card the writer hasn't approved. Rejections recorded here are the ones with no
 * fact to carry them (src/extraction/apply.ts derives the rest from set-aside facts).
 */

/** What a pending proposal is about: an existing entity, or a pending new card. */
export type EntityRef = { entityId: string } | { cardId: string };

export interface PendingProposal {
  id: string;
  ref: EntityRef;
  attribute: string;
  value: string | StoryPosition;
  strength: Strength;
  evidence: Evidence[];
  /** The earlier value this replaces within the same source. */
  replaces?: string;
  createdAt: string;
  [extra: string]: unknown;
}

/** A card the AI proposed that isn't a binder item yet. */
export interface PendingCard {
  id: string;
  kind: EntityKind;
  title: string;
  reason: string;
  createdAt: string;
  [extra: string]: unknown;
}

export interface StoredRejection {
  fingerprint: string;
  /** What the writer sees in the Rejected list, e.g. "eyes: blue" or "New card: Ivo". */
  label: string;
  at: string;
  [extra: string]: unknown;
}

/** The validated results of one source, keyed by its content, prompt version, provider and model. */
export interface CachedRun {
  itemId: string;
  key: string;
  provider: ProviderId;
  model: string;
  at: string;
  proposals: RawProposal[];
  dropped: number;
  [extra: string]: unknown;
}

export interface ExtractionState {
  rejections: StoredRejection[];
  /** One per source item: the latest run. */
  runs: CachedRun[];
  cards: PendingCard[];
  pending: PendingProposal[];
  [extra: string]: unknown;
}

export const emptyExtraction = (): ExtractionState => ({ rejections: [], runs: [], cards: [], pending: [] });

/** The bible and the extraction state, changed together by extraction and review. */
export interface Canon {
  bible: import('@/project/types').Bible;
  extraction: ExtractionState;
}
