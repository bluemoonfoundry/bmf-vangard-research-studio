import type { Capabilities, ProviderId, StreamEvent } from '@/ai/types';
import { CHAT_PERSONAS, DEFAULT_PERSONA_ID } from '@/chat/personas';
import type { ChatMessage, ChatSettings, ChatTranscript } from '@/chat/types';

const personaPrompt = (id: string): string =>
  CHAT_PERSONAS.find(p => p.id === id)?.systemPrompt ?? '';

function defaultSettings(defaults: { provider: ProviderId | null; model: string | null }): ChatSettings {
  return {
    provider: defaults.provider,
    model: defaults.model,
    personaId: DEFAULT_PERSONA_ID,
    systemPrompt: personaPrompt(DEFAULT_PERSONA_ID),
    temperature: null,
    webSearch: false,
    readUrls: false,
    attachments: [],
    filterMode: 'all',
  };
}

export const newTranscript = (defaults: { provider: ProviderId | null; model: string | null }): ChatTranscript => ({
  version: 1,
  settings: defaultSettings(defaults),
  messages: [],
});

export function normalizeTranscript(raw: unknown): ChatTranscript {
  const obj = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const base = defaultSettings({ provider: null, model: null });
  const given = (obj.settings && typeof obj.settings === 'object' ? obj.settings : {}) as Record<string, unknown>;
  const settings = { ...base, ...given } as ChatSettings;
  if (!Array.isArray(settings.attachments)) settings.attachments = [];
  const messages = Array.isArray(obj.messages) ? (obj.messages as ChatMessage[]) : [];
  return { ...obj, version: 1, settings, messages };
}

interface SendArgs { assistantId: string; at: string; caps: Capabilities }

function pendingAssistant(t: ChatTranscript, a: SendArgs): ChatMessage {
  const s = t.settings;
  return {
    id: a.assistantId, role: 'assistant', text: '', createdAt: a.at,
    provider: s.provider, model: s.model, status: 'streaming', error: null,
    usedWebSearch: s.webSearch && a.caps.webSearch,
    usedReadUrls: s.readUrls && a.caps.readUrls,
  };
}

export function beginSend(
  t: ChatTranscript, args: SendArgs & { text: string; userId: string },
): ChatTranscript {
  const user: ChatMessage = { id: args.userId, role: 'user', text: args.text, createdAt: args.at, edited: false };
  return { ...t, messages: [...t.messages, user, pendingAssistant(t, args)] };
}

export function beginResubmit(
  t: ChatTranscript, args: SendArgs & { messageId: string; text?: string },
): ChatTranscript {
  const i = t.messages.findIndex(m => m.id === args.messageId && m.role === 'user');
  if (i < 0) return t;
  const orig = t.messages[i];
  const changed = args.text !== undefined && args.text !== orig.text;
  const user: ChatMessage = {
    ...orig,
    text: args.text ?? orig.text,
    edited: changed ? true : orig.edited ?? false,
  };
  return { ...t, messages: [...t.messages.slice(0, i), user, pendingAssistant(t, args)] };
}

const mapMessage = (t: ChatTranscript, id: string, fn: (m: ChatMessage) => ChatMessage): ChatTranscript =>
  t.messages.some(m => m.id === id)
    ? { ...t, messages: t.messages.map(m => (m.id === id ? fn(m) : m)) }
    : t;

export function applyStreamEvent(t: ChatTranscript, assistantId: string, e: StreamEvent): ChatTranscript {
  return mapMessage(t, assistantId, m => {
    switch (e.type) {
      case 'text':
        return { ...m, text: m.text + e.delta };
      case 'sources': {
        const seen = new Set((m.sources ?? []).map(s => s.url));
        const added = e.sources.filter(s => !seen.has(s.url) && seen.add(s.url));
        return { ...m, sources: [...(m.sources ?? []), ...added] };
      }
      case 'extras':
        return { ...m, providerExtras: e.extras };
      case 'done':
        return { ...m, status: 'complete', model: e.model, ...(e.truncated && { truncated: e.truncated }) };
      case 'error':
        return e.code === 'CANCELLED'
          ? { ...m, status: 'cancelled' }
          : { ...m, status: 'error', error: { code: e.code, message: e.message } };
    }
  });
}

export const editMessageText = (t: ChatTranscript, id: string, text: string): ChatTranscript =>
  mapMessage(t, id, m => (m.text === text ? m : { ...m, text, edited: true }));

export const deleteMessage = (t: ChatTranscript, id: string): ChatTranscript =>
  t.messages.some(m => m.id === id) ? { ...t, messages: t.messages.filter(m => m.id !== id) } : t;

export function deleteBefore(t: ChatTranscript, id: string): ChatTranscript {
  const i = t.messages.findIndex(m => m.id === id);
  return i < 0 ? t : { ...t, messages: t.messages.slice(i) };
}

export function deleteAfter(t: ChatTranscript, id: string): ChatTranscript {
  const i = t.messages.findIndex(m => m.id === id);
  return i < 0 ? t : { ...t, messages: t.messages.slice(0, i + 1) };
}

export const updateSettings = (t: ChatTranscript, patch: Partial<ChatSettings>): ChatTranscript => ({
  ...t, settings: { ...t.settings, ...patch },
});

export const isStreaming = (t: ChatTranscript): boolean => t.messages.some(m => m.status === 'streaming');

export const forPersistence = (t: ChatTranscript): ChatTranscript =>
  isStreaming(t)
    ? { ...t, messages: t.messages.map(m => (m.status === 'streaming' ? { ...m, status: 'cancelled' as const } : m)) }
    : t;

export const transcriptPlainText = (t: ChatTranscript): string =>
  t.messages
    .map(m => (m.role === 'user' ? `You: ${m.text}` : `AI (${m.model ?? 'unknown'}): ${m.text}`))
    .join('\n\n');

export function locateQuote(text: string, quote: string): { start: number; end: number } | null {
  if (!quote) return null;
  const start = text.indexOf(quote);
  return start < 0 ? null : { start, end: start + quote.length };
}
