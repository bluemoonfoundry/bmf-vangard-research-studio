import type { ChatTranscript } from '@/chat/types';

/** Renderer-side shapes of the project format defined in electron/lib/projectSchema.js. */

export interface ProjectManifest {
  schemaVersion: number;
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  settings: Record<string, unknown>;
}

export type ItemType = 'folder' | 'document' | 'image' | 'webpage' | 'audio' | 'entity' | 'chat' | 'ai-chat';

export type LabelId =
  | 'concept' | 'character' | 'setting' | 'plot' | 'verified_fact' | 'unverified' | 'primary_source' | 'lore';

export type StatusId = 'to_read' | 'in_progress' | 'notes_taken' | 'incorporated' | 'archived';

export interface Citation {
  id: string;
  source: string;
  quote?: string;
  pageOrUrl?: string;
  year?: string;
}

/** A link to another binder item. The title is looked up live, never stored. */
export interface Reference {
  id: string;
  targetId: string;
  note?: string;
}

export interface MediaMetadata {
  sourceDomain?: string;
  author?: string;
  year?: string;
  archivalRefNumber?: string;
}

/**
 * A binder item in tree.json. Its body text lives in docs/<id>.md; everything
 * else (index-card synopsis, inspector fields, media reference) lives here.
 * Fields other than id/parentId/type/title/order/keywords are optional, so
 * older projects and hand-edited trees stay valid.
 */
export interface TreeItem {
  id: string;
  parentId: string | null;
  /** An ItemType; unknown types from newer versions are kept and shown as documents. */
  type: string;
  title: string;
  order: number;
  keywords: string[];
  createdAt?: string;
  updatedAt?: string;
  synopsis?: string;
  label?: LabelId | null;
  status?: StatusId | null;
  documentNotes?: string;
  references?: Reference[];
  citations?: Citation[];
  targetWordCount?: number;
  /** File name under assets/ for image and audio items. */
  asset?: string;
  mediaAlt?: string;
  /** Source page of a web clipping. */
  url?: string;
  mediaMetadata?: MediaMetadata;
  entityKind?: string;
  importedFrom?: string;
  /** How an imported chat was recognised (src/chat/importFormats.ts ImportedFormat). */
  importedFormat?: string;
  /** Where an imported chat came from, e.g. its AI Studio page. Opened through app:open-external. */
  sourceUrl?: string;
  /** Attribute keys pinned to an entity's card on the card wall, in order (src/bible/cards.ts). */
  cardFacts?: string[];
  /** The image item shown as an entity's portrait; defaults to its first linked image. */
  portraitId?: string;
  /** A source with no turns that is the writer's own writing: its extracted proposals count as "said". */
  ownWriting?: boolean;
  [extra: string]: unknown;
}

export type EntityKind = 'character' | 'location' | 'faction' | 'item' | 'lore' | 'event' | 'plotline';

export interface StoryPosition { season: number; episode?: number; order?: number }

/** An age that held a number of years after the story's start (whole numbers, year 0 = the start). Only on `age` facts. */
export interface DatedAge { age: number; year: number }

export type FactValue = string | StoryPosition | DatedAge;

export type FactStatus = 'proposed' | 'kept' | 'set_aside';

/** Where a fact was captured. With `messageId` (an AI Chat message), offsets are into that message's stored text. */
export interface FactSource { itemId: string; messageId?: string; quote: string; start: number; end: number }

/** One passage supporting an AI-extracted fact, and how firmly it establishes it. */
export interface Evidence { source: FactSource; strength: import('@/ai/types').Strength }

export interface Fact {
  id: string;
  entityId: string;
  attribute: string;
  value: FactValue;
  status: FactStatus;
  /** The primary source; with `evidence`, its first entry. */
  source?: FactSource;
  /** Every passage AI extraction found for this value (repeated mentions merge here). */
  evidence?: Evidence[];
  /** The earlier value this replaced within the same source. */
  replaces?: string;
  origin: string;
  note?: string;
  createdAt: string;
  updatedAt: string;
  [extra: string]: unknown;
}

export interface Dependency { id: string; eventId: string; afterEventId: string }

export interface Decision {
  id: string;
  entityId: string;
  attribute: string;
  kind: 'kept_one' | 'kept_all';
  factIds: string[];
  setAsideIds: string[];
  note?: string;
  at: string;
}

export interface Bible {
  facts: Fact[];
  dependencies: Dependency[];
  decisions: Decision[];
  /** Ids of chat, AI chat and document items, oldest first (src/bible/sourceOrder.ts). */
  sourceOrder?: string[];
}

export interface ProjectTree {
  items: TreeItem[];
}

/** What the renderer may write: the main process owns ids, versions and timestamps. */
export interface SavePayload {
  manifest?: { name: string; settings?: Record<string, unknown> };
  tree?: ProjectTree;
  /** Document bodies by item id; null deletes the document file. */
  docs?: Record<string, string | null>;
  /** AI chat transcripts by item id; null deletes the transcript file. */
  chats?: Record<string, ChatTranscript | null>;
  bible?: Bible;
  /** bible/extraction.json: AI extraction's pending proposals, rejections and run cache. */
  extraction?: import('@/extraction/types').ExtractionState;
  /** Asset files to remove; the main process keeps any the saved tree still references. */
  deletedAssets?: string[];
}

export type MediaKind = 'image' | 'audio';

export interface TextImport {
  /** The picked file's name without its extension. */
  title: string;
  /** File contents with the BOM removed and LF line endings. */
  text: string;
  fileName: string;
}

export interface SkippedImport { fileName: string; message: string }

/** The transcripts picked in one import dialog: what could be read, and what was skipped and why. */
export interface TextImportBatch { imports: TextImport[]; skipped: SkippedImport[] }

export interface ImportedAsset {
  /** File name under assets/. */
  asset: string;
  /** The picked file's name without its extension. */
  originalName: string;
  bytes: number;
}

export interface RecoverySnapshot extends SavePayload {
  savedAt: string;
}

export interface OpenedProject {
  root: string;
  manifest: ProjectManifest;
  tree: ProjectTree;
  bible: Bible;
  /** Missing (an older main process or snapshot) reads as empty. */
  extraction?: import('@/extraction/types').ExtractionState;
  /** Schema version the project was upgraded from on open, or null. */
  migratedFrom: number | null;
  recovery: RecoverySnapshot | null;
}

export interface RecentProject {
  root: string;
  name: string;
  openedAt: string;
  missing: boolean;
}

export interface ExternalChange {
  /** Project-relative, forward slashes. */
  path: string;
  deleted: boolean;
}

export type UnsavedChoice = 'save' | 'discard' | 'cancel';

export type IpcResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: { code: string; message: string } };
