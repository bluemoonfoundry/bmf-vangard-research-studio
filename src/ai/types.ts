/** Renderer-side types for the opt-in AI layer. Mirrors electron/lib/llm (spec §1–§2). */

export type ProviderId = 'gemini' | 'anthropic' | 'openai';

export const PROVIDERS: { id: ProviderId; name: string }[] = [
  { id: 'gemini', name: 'Google Gemini' },
  { id: 'anthropic', name: 'Anthropic Claude' },
  { id: 'openai', name: 'OpenAI' },
];

export interface ProviderStatus {
  configured: boolean;
  /** ISO time of the last successful key test, or null. */
  lastTestOk: string | null;
}

/** The non-secret AI settings the renderer may see. Never carries key material. */
export interface AiStatus {
  enabled: boolean;
  defaultProvider: ProviderId | null;
  defaultModel: string | null;
  encryptionAvailable: boolean;
  providers: Record<ProviderId, ProviderStatus>;
  /** A user-facing message when the stored keys can't be read; null when fine. */
  keyStoreProblem: string | null;
}

export type AiSettingsPatch = Partial<Pick<AiStatus, 'enabled' | 'defaultProvider' | 'defaultModel'>>;

export interface Capabilities {
  webSearch: boolean;
  readUrls: boolean;
  temperature: boolean;
}

export interface ModelInfo {
  id: string;
  name: string;
  inputTokenLimit?: number;
  capabilities: Capabilities;
}

export interface ChatRequest {
  provider: ProviderId;
  model: string;
  system: string;
  messages: { role: 'user' | 'assistant'; text: string }[];
  temperature?: number;
  webSearch: boolean;
  readUrls: boolean;
}

/** A normalized citation: http(s) only, deduplicated by URL. */
export interface Source {
  title?: string;
  url: string;
}

/** Provider-specific display data, never sent back to a model. */
export interface ProviderExtras {
  gemini?: { searchEntryPointHtml: string };
}

/**
 * Why a reply that ended normally is unfinished: the output token limit (or the context window), a server-tool turn the
 * provider paused (Anthropic pause_turn), or another early stop (e.g. OpenAI content_filter).
 */
export type TruncatedReason = 'max_tokens' | 'pause_turn' | 'other';

export type StreamEvent =
  | { type: 'text'; delta: string }
  | { type: 'sources'; sources: Source[] }
  | { type: 'extras'; extras: ProviderExtras }
  | { type: 'done'; model: string; usage?: { inputTokens?: number; outputTokens?: number }; truncated?: TruncatedReason }
  | { type: 'error'; code: string; message: string };

export interface ChatEvent {
  requestId: string;
  event: StreamEvent;
}

/**
 * How firmly a source establishes a proposal: stated in the writer's own turn, offered by the model
 * and then used by the writer, or offered and never taken up.
 */
export type Strength = 'said' | 'built_on' | 'suggested';

/** A quote as the model returned it; `turn` is 1-based, 0 when unknown. */
export interface RawEvidence { quote: string; turn: number }

/** One extraction proposal as validated by the main process (electron/lib/llm/extractionSchema.js). */
export interface RawProposal {
  /** `id` is an existing entity's id, or '' for a new card proposal. `reason` is '' unless new. */
  entity: { id: string; name: string; kind: string; reason: string };
  attribute: string;
  value: string;
  strength: Strength;
  evidence: RawEvidence[];
  /** The earlier value this replaces within the same source, or ''. */
  replaces: string;
}

/** What llm:extract sends: the renderer builds the text; the main process adds the schema. */
export interface ExtractRequest {
  provider: ProviderId;
  model: string;
  system: string;
  text: string;
}

/** One flag of a semantic conflict check: two fact refs ("F1") from the request and why they clash. */
export interface RawConflict { a: string; b: string; reason: string }

/** What llm:conflict-check resolves with (electron/lib/llm/conflictSchema.js). */
export interface ConflictCheckResult {
  conflicts: RawConflict[];
  /** Malformed flags the main process dropped. */
  dropped: number;
  model: string;
  usage?: { inputTokens?: number; outputTokens?: number };
}

export interface ExtractResult {
  proposals: RawProposal[];
  /** What was established so far, carried into the next chunk's request. */
  summary: string;
  /** Malformed proposals the main process dropped. */
  dropped: number;
  model: string;
  usage?: { inputTokens?: number; outputTokens?: number };
}
