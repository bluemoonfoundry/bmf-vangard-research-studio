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

export type StreamEvent =
  | { type: 'text'; delta: string }
  | { type: 'sources'; sources: Source[] }
  | { type: 'extras'; extras: ProviderExtras }
  | { type: 'done'; model: string; usage?: { inputTokens?: number; outputTokens?: number } }
  | { type: 'error'; code: string; message: string };

export interface ChatEvent {
  requestId: string;
  event: StreamEvent;
}
