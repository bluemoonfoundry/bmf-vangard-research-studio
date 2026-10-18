import { useEffect, useMemo, useState } from 'react';
import { Send, Square } from 'lucide-react';
import type { Capabilities, ModelInfo, ProviderId } from '@/ai/types';
import type { Bible, EntityKind, TreeItem } from '@/project/types';
import type { ChatEntry } from '@/project/projectState';
import { buildChatRequest, estimateTokens, type ChatOf, type ContentOf } from '@/chat/buildChatRequest';
import { deleteAfter, deleteBefore, deleteMessage, editMessageText, updateSettings } from '@/chat/transcript';
import type { ChatFilterMode, ChatSettings, ChatTranscript } from '@/chat/types';
import { ChatHeader } from '@/components/chat/ChatHeader';
import { ChatMessageView } from '@/components/chat/ChatMessageView';
import { PersonaDrawer } from '@/components/chat/PersonaDrawer';
import { AttachmentsPanel } from '@/components/chat/AttachmentsPanel';
import type { EntityPanelProps } from '@/components/bible/EntityPanel';
import { ConfirmDialog } from '@/components/workspace/ConfirmDialog';
import { btn, btnPrimary, input } from '@/components/workspace/ui';

/** Story Bible wiring for capturing facts from messages (used from Task 13 on). */
export interface CaptureWiring {
  bible: Omit<EntityPanelProps, 'entity'>;
  addEntity(kind: EntityKind, title: string, parentId: string | null): string;
}

export interface ChatEditorProps {
  item: TreeItem;
  /** The loaded transcript, or undefined while it loads. */
  entry: ChatEntry | undefined;
  aiEnabled: boolean;
  configuredProviders: ProviderId[];
  models(provider: ProviderId): ModelInfo[] | undefined;
  loadModels(provider: ProviderId, refresh?: boolean): Promise<ModelInfo[]>;
  capsOf(provider: ProviderId, model: string): Capabilities;
  /** True while a reply streams into this chat. */
  streaming: boolean;
  onUpdate(update: (t: ChatTranscript) => ChatTranscript): void;
  onRename(title: string): void;
  onSend(text: string): void;
  onResubmit(messageId: string, text?: string): void;
  onStop(): void;
  items: TreeItem[];
  bible: Bible;
  contentOf: ContentOf;
  /** Transcripts of other AI chats (for attached chats in the context estimate). */
  chatOf?: ChatOf;
  onOpenLink(url: string): void;
  capture?: CaptureWiring;
  highlight?: { messageId: string; start: number; end: number } | null;
}

const NO_CAPS: Capabilities = { webSearch: false, readUrls: false, temperature: false };
/** The context indicator turns into a warning from this share of the model's input limit. */
const WARN_SHARE = 0.9;

/**
 * An AI Chat: transcript, settings and composer. It only renders and issues commands; replies stream at project
 * level (useChatStreams), so they survive this editor unmounting. Mount it with `key={item.id}`.
 */
export function ChatEditor(props: ChatEditorProps) {
  const {
    item, entry, aiEnabled, configuredProviders, models, loadModels, capsOf, streaming,
    onUpdate, onRename, onSend, onResubmit, onStop, items, bible, contentOf, chatOf, onOpenLink,
  } = props;
  const [composer, setComposer] = useState('');
  const [personaOpen, setPersonaOpen] = useState(false);
  const [attachmentsOpen, setAttachmentsOpen] = useState(false);
  /** The filter in a read-only chat (AI off): a view choice that isn't written to the file. */
  const [viewFilter, setViewFilter] = useState<ChatFilterMode | null>(null);
  const [confirm, setConfirm] = useState<{ messageId: string; side: 'before' | 'after'; count: number } | null>(null);

  const transcript = entry?.current;
  const settings = transcript?.settings;
  const provider = settings?.provider ?? null;
  const configured = provider !== null && configuredProviders.includes(provider);
  const list = provider && configured ? models(provider) : undefined;
  const model = settings?.model ? list?.find(m => m.id === settings.model) : undefined;
  const listLoaded = list !== undefined;

  useEffect(() => {
    if (aiEnabled && provider && configured && !listLoaded) void loadModels(provider);
  }, [aiEnabled, provider, configured, listLoaded, loadModels]);

  const tokens = useMemo(() => {
    if (!transcript || !aiEnabled) return 0;
    const caps = provider && settings?.model ? capsOf(provider, settings.model) : NO_CAPS;
    // Only the text matters for the estimate; placeholders stand in for a missing provider/model.
    const probe = updateSettings(transcript, { provider: provider ?? 'anthropic', model: settings?.model ?? '?' });
    return estimateTokens(buildChatRequest({
      transcript: probe, uptoIndex: probe.messages.length, items, bible, contentOf, chatOf, chatId: item.id, caps,
    }));
  }, [transcript, aiEnabled, provider, settings?.model, capsOf, items, bible, contentOf, chatOf, item.id]);

  if (!entry || !transcript || !settings) {
    return <p className="p-6 text-sm text-content-muted">Loading…</p>;
  }

  const setSettings = (patch: Partial<ChatSettings>) => {
    if (aiEnabled) onUpdate(t => updateSettings(t, patch));
    else if (patch.filterMode) setViewFilter(patch.filterMode);
  };
  const filterMode = (!aiEnabled && viewFilter) || settings.filterMode;
  const messages = transcript.messages;
  const shown = filterMode === 'all'
    ? messages
    : messages.filter(m => (filterMode === 'user_only' ? m.role === 'user' : m.role === 'assistant'));
  const unavailable = listLoaded && settings.model !== null && !model;
  const canSend = aiEnabled && !streaming && model !== undefined && composer.trim() !== '';
  const limit = model?.inputTokenLimit;
  const warn = limit !== undefined && tokens >= limit * WARN_SHARE;

  const send = () => {
    if (!canSend) return;
    onSend(composer.trim());
    setComposer('');
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <ChatHeader
        title={item.title}
        onRename={onRename}
        settings={{ ...settings, filterMode }}
        onSettings={setSettings}
        editable={aiEnabled}
        configuredProviders={configuredProviders}
        models={list}
        model={model}
        onRefreshModels={() => provider && void loadModels(provider, true)}
        personaOpen={personaOpen}
        onTogglePersona={() => setPersonaOpen(o => !o)}
        attachmentsOpen={attachmentsOpen}
        onToggleAttachments={() => setAttachmentsOpen(o => !o)}
      />
      {aiEnabled && personaOpen && (
        <PersonaDrawer personaId={settings.personaId} systemPrompt={settings.systemPrompt} onChange={setSettings} onClose={() => setPersonaOpen(false)} />
      )}
      {aiEnabled && attachmentsOpen && (
        <AttachmentsPanel chatId={item.id} attachments={settings.attachments} items={items} onChange={(attachments) => setSettings({ attachments })} />
      )}

      {entry.problem && (
        <p role="alert" className="border-b border-line bg-surface-sunken px-4 py-2 text-xs text-danger">This chat file couldn&apos;t be read: {entry.problem}</p>
      )}
      {!aiEnabled && (
        <p role="note" className="border-b border-line bg-surface-sunken px-4 py-2 text-xs text-content-muted">Turn on AI in Settings to continue this chat.</p>
      )}
      {aiEnabled && unavailable && (
        <p role="alert" className="border-b border-line bg-surface-sunken px-4 py-2 text-xs text-warning">
          This chat&apos;s model is no longer available. Pick another model to continue.
        </p>
      )}

      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-4xl flex-col gap-3 px-6 py-4">
          {filterMode !== 'all' && (
            <p className="rounded border border-line bg-surface-raised px-3 py-1.5 text-xs text-content-muted">
              Showing {shown.length} of {messages.length} messages
            </p>
          )}
          {messages.length === 0 && (
            <p className="py-10 text-center text-sm text-content-muted">
              {aiEnabled ? 'Ask a question about your story or research. The chat sees your kept canon and any attachments.' : 'This chat has no messages.'}
            </p>
          )}
          {shown.map(m => {
            const index = messages.indexOf(m);
            const countAfter = messages.length - index - 1;
            return (
              <ChatMessageView
                key={m.id}
                message={m}
                busy={streaming}
                onOpenLink={onOpenLink}
                actions={aiEnabled ? {
                  onSaveText: (text) => onUpdate(t => editMessageText(t, m.id, text)),
                  onSaveAndResubmit: (text) => onResubmit(m.id, text),
                  onResubmit: () => onResubmit(m.id, undefined),
                  onDelete: () => onUpdate(t => deleteMessage(t, m.id)),
                  onDeleteBefore: () => setConfirm({ messageId: m.id, side: 'before', count: index }),
                  onDeleteAfter: () => setConfirm({ messageId: m.id, side: 'after', count: countAfter }),
                  countBefore: index,
                  countAfter,
                } : null}
              />
            );
          })}
        </div>
      </div>

      {aiEnabled && (
        <div className="shrink-0 border-t border-line bg-surface-raised px-4 py-2.5">
          <div className="mx-auto flex w-full max-w-4xl flex-col gap-1.5">
            <textarea
              aria-label="Message"
              rows={3}
              className={`${input} w-full resize-none text-sm`}
              placeholder="Ask about your story… (Enter sends, Shift+Enter adds a line)"
              value={composer}
              onChange={(e) => setComposer(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== 'Enter' || e.shiftKey || e.nativeEvent.isComposing) return;
                e.preventDefault();
                send();
              }}
            />
            <div className="flex items-center justify-between gap-2 text-[11px] text-content-muted">
              <span
                role="status"
                aria-label="Context size"
                data-warning={warn}
                className={warn ? 'font-semibold text-warning' : ''}
                title="Rough estimate of system prompt, canon, attachments and history. Nothing is trimmed."
              >
                ~{tokens.toLocaleString()} tokens{limit !== undefined && ` of ${limit.toLocaleString()}`}{warn && ' — close to the model’s input limit'}
              </span>
              {streaming ? (
                <button type="button" className={btn} onClick={onStop}>
                  <Square className="h-3.5 w-3.5" /> Stop
                </button>
              ) : (
                <button type="button" className={btnPrimary} disabled={!canSend} onClick={send}>
                  <Send className="h-3.5 w-3.5" /> Send
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {confirm && (
        <ConfirmDialog
          title="Delete messages"
          message={`Delete the ${confirm.count} ${confirm.count === 1 ? 'message' : 'messages'} ${confirm.side} this one?`}
          confirmLabel="Delete"
          onCancel={() => setConfirm(null)}
          onConfirm={() => {
            const { messageId, side } = confirm;
            onUpdate(t => (side === 'before' ? deleteBefore(t, messageId) : deleteAfter(t, messageId)));
            setConfirm(null);
          }}
        />
      )}
    </div>
  );
}
