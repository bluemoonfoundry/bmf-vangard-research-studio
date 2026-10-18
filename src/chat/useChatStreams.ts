import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AiApi } from '@/ai/aiApi';
import type { Capabilities, ChatEvent, ProviderId, StreamEvent } from '@/ai/types';
import type { ProjectController } from '@/project/useProject';
import { buildChatRequest } from '@/chat/buildChatRequest';
import { applyStreamEvent, beginResubmit, beginSend } from '@/chat/transcript';
import type { ChatTranscript } from '@/chat/types';

export interface UseChatStreamsOptions {
  ai: AiApi | null;
  project: ProjectController;
  capsOf(provider: ProviderId, model: string): Capabilities;
}

export interface ChatStreams {
  send(chatId: string, text: string): void;
  /** Re-sends a user message (optionally with new text), dropping every message after it. */
  resubmit(chatId: string, messageId: string, text?: string): void;
  stop(chatId: string): void;
  /** Chat ids with a reply in flight. */
  streamingIds: ReadonlySet<string>;
  error: string | null;
}

interface Route { chatId: string; assistantId: string }

const CANCELLED: StreamEvent = { type: 'error', code: 'CANCELLED', message: 'Cancelled' };

/** True while the chat is loaded and its binder item still exists. */
const chatExists = (project: ProjectController, chatId: string): boolean =>
  !!project.state?.chats[chatId] && project.state.tree.items.some(i => i.id === chatId);

const errorOf = (err: unknown): { code: string; message: string } => {
  const code = typeof (err as { code?: unknown })?.code === 'string' ? (err as { code: string }).code : 'UNKNOWN';
  return { code, message: err instanceof Error ? err.message : String(err) };
};

/**
 * Project-level stream manager (spec §4): replies stream into project state whether or not a chat's editor is
 * mounted, and several chats can stream at once. Routes `requestId → { chatId, assistantId }`.
 */
export function useChatStreams({ ai, project, capsOf }: UseChatStreamsOptions): ChatStreams {
  // Commands read the latest project and capabilities, not the render they were created in.
  const projectRef = useRef(project);
  projectRef.current = project;
  const capsRef = useRef(capsOf);
  capsRef.current = capsOf;

  const routes = useRef(new Map<string, Route>());
  const [streamingIds, setStreamingIds] = useState<ReadonlySet<string>>(() => new Set());
  const [error, setError] = useState<string | null>(null);

  const syncStreaming = useCallback(() => {
    setStreamingIds(new Set([...routes.current.values()].map(r => r.chatId)));
  }, []);

  /** Applies one event to its route's message; terminal events (and vanished chats) end the route. */
  const deliver = useCallback((requestId: string, event: StreamEvent) => {
    const route = routes.current.get(requestId);
    if (!route) return;
    const terminal = event.type === 'done' || event.type === 'error';
    if (!chatExists(projectRef.current, route.chatId)) {
      routes.current.delete(requestId);
      syncStreaming();
      if (!terminal) void ai?.cancelChat(requestId).catch(() => {});
      return;
    }
    projectRef.current.updateChat(route.chatId, t => applyStreamEvent(t, route.assistantId, event));
    if (terminal) {
      routes.current.delete(requestId);
      syncStreaming();
    }
  }, [ai, syncStreaming]);

  useEffect(() => {
    if (!ai) return;
    const unsubscribe = ai.onChatEvent(({ requestId, event }: ChatEvent) => deliver(requestId, event));
    const live = routes.current;
    return () => {
      unsubscribe();
      // Partial replies are kept as cancelled. cancelAll is refused while AI is off; nothing streams then anyway.
      for (const requestId of [...live.keys()]) deliver(requestId, CANCELLED);
      void ai.cancelAll().catch(() => {});
    };
  }, [ai, deliver]);

  /** Starts a reply: `begin` adds the pending message, and history runs up to it. */
  const start = useCallback((chatId: string, begin: (t: ChatTranscript, args: { assistantId: string; at: string; caps: Capabilities }) => ChatTranscript) => {
    const state = projectRef.current.state;
    const entry = state?.chats[chatId];
    if (!ai || !state || !entry || !chatExists(projectRef.current, chatId)) return;
    if ([...routes.current.values()].some(r => r.chatId === chatId)) return;
    const { provider, model } = entry.current.settings;
    if (!provider || !model) {
      setError('Pick a provider and model for this chat first.');
      return;
    }

    const args = { assistantId: crypto.randomUUID(), at: new Date().toISOString(), caps: capsRef.current(provider, model) };
    const next = begin(entry.current, args);
    const uptoIndex = next.messages.findIndex(m => m.id === args.assistantId);
    if (uptoIndex < 0) return;
    const request = buildChatRequest({
      transcript: next,
      uptoIndex,
      items: state.tree.items,
      bible: state.bible,
      contentOf: id => state.docs[id]?.current,
      chatOf: id => state.chats[id]?.current,
      chatId,
      caps: args.caps,
    });

    const requestId = crypto.randomUUID();
    setError(null);
    projectRef.current.updateChat(chatId, t => begin(t, args));
    routes.current.set(requestId, { chatId, assistantId: args.assistantId });
    syncStreaming();
    ai.startChat(requestId, request).then(() => {
      // Stopped (or the chat vanished) before main registered the request: that cancel found nothing to abort.
      if (!routes.current.has(requestId)) void ai.cancelChat(requestId).catch(() => {});
    }, (err: unknown) => {
      const { code, message } = errorOf(err);
      if (routes.current.has(requestId) && code !== 'CANCELLED') setError(message);
      deliver(requestId, { type: 'error', code, message });
    });
  }, [ai, deliver, syncStreaming]);

  const send = useCallback((chatId: string, text: string) => {
    // Generated once, so the reducer's update stays pure (it may run more than once).
    const userId = crypto.randomUUID();
    start(chatId, (t, a) => beginSend(t, { ...a, text, userId }));
  }, [start]);

  const resubmit = useCallback((chatId: string, messageId: string, text?: string) =>
    start(chatId, (t, a) => beginResubmit(t, { ...a, messageId, text })), [start]);

  /** Cancels this chat's reply; the partial text is kept as cancelled even if main refuses the cancel. */
  const stop = useCallback((chatId: string) => {
    for (const [requestId, route] of [...routes.current]) {
      if (route.chatId !== chatId) continue;
      void ai?.cancelChat(requestId).catch(() => {});
      deliver(requestId, CANCELLED);
    }
  }, [ai, deliver]);

  return useMemo(() => ({ send, resubmit, stop, streamingIds, error }), [send, resubmit, stop, streamingIds, error]);
}
