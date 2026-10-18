import type { ProviderExtras, ProviderId, Source, TruncatedReason } from '@/ai/types';

export type ChatFilterMode = 'all' | 'user_only' | 'model_only';

export type ChatMessageStatus = 'streaming' | 'complete' | 'cancelled' | 'error';

export interface ChatSettings {
  provider: ProviderId | null;
  model: string | null;
  /** null = custom system prompt. */
  personaId: string | null;
  systemPrompt: string;
  /** null = provider default. */
  temperature: number | null;
  webSearch: boolean;
  readUrls: boolean;
  /** Binder item ids (documents or folders). */
  attachments: string[];
  filterMode: ChatFilterMode;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  createdAt: string;
  edited?: boolean;
  provider?: ProviderId | null;
  model?: string | null;
  status?: ChatMessageStatus;
  error?: { code: string; message: string } | null;
  /** Set on a complete reply the provider stopped early. */
  truncated?: TruncatedReason;
  sources?: Source[];
  usedWebSearch?: boolean;
  usedReadUrls?: boolean;
  providerExtras?: ProviderExtras;
  [k: string]: unknown;
}

export interface ChatTranscript {
  version: 1;
  settings: ChatSettings;
  messages: ChatMessage[];
  [k: string]: unknown;
}

/** An AI chat's transcript by item id, or undefined while it loads. */
export type ChatOf = (id: string) => ChatTranscript | undefined;
