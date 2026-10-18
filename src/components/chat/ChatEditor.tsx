import { useCallback, useEffect, useMemo, useState } from 'react';
import { Send, Square } from 'lucide-react';
import type { ModelInfo, ProviderId } from '@/ai/types';
import type { Bible, EntityKind, TreeItem } from '@/project/types';
import type { ChatEntry } from '@/project/projectState';
import {
  buildAttachmentsText, buildCanonText, historyOf, systemText, type ChatOf, type ContentOf,
} from '@/chat/buildChatRequest';
import { deleteAfter, deleteBefore, deleteMessage, editMessageText, updateSettings } from '@/chat/transcript';
import type { ChatFilterMode, ChatSettings, ChatTranscript } from '@/chat/types';
import { ChatHeader } from '@/components/chat/ChatHeader';
import { ChatMessageView } from '@/components/chat/ChatMessageView';
import { PersonaDrawer } from '@/components/chat/PersonaDrawer';
import { AttachmentsPanel } from '@/components/chat/AttachmentsPanel';
import { CaptureHost, type CaptureSelection } from '@/components/bible/CapturePopover';
import type { EntityPanelProps } from '@/components/bible/EntityPanel';
import { ConfirmDialog } from '@/components/workspace/ConfirmDialog';
import { btn, btnPrimary, input } from '@/components/workspace/ui';

/** Story Bible wiring for capturing facts from messages. Capture works in a read-only chat too. */
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
  /** Why the provider's last model-list load failed, or null. */
  modelsError?(provider: ProviderId): string | null;
  /** True while a reply streams into this chat. */
  streaming: boolean;
  /** Why this chat's last send or resubmit was refused, or null. */
  streamError?: string | null;
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
  /** A cited range in one message (from a fact's source): that message opens raw with the range marked. */
  highlight?: { messageId: string; start: number; end: number } | null;
}

/** The context indicator turns into a warning from this share of the model's input limit. */
const WARN_SHARE = 0.9;

/**
 * An AI Chat: transcript, settings and composer. It only renders and issues commands; replies stream at project
 * level (useChatStreams), so they survive this editor unmounting. Mount it with `key={item.id}`.
 */
export function ChatEditor(props: ChatEditorProps) {
  const {
    item, entry, aiEnabled, configuredProviders, models, loadModels, modelsError, streaming, streamError,
    onUpdate, onRename, onSend, onResubmit, onStop, items, bible, contentOf, chatOf, onOpenLink, capture, highlight,
  } = props;
  const [composer, setComposer] = useState('');
  const [personaOpen, setPersonaOpen] = useState(false);
  const [attachmentsOpen, setAttachmentsOpen] = useState(false);
  /** The filter in a read-only chat (AI off): a view choice that isn't written to the file. */
  const [viewFilter, setViewFilter] = useState<ChatFilterMode | null>(null);
  const [loadingModels, setLoadingModels] = useState(false);
  const [confirm, setConfirm] = useState<{ messageId: string; side: 'before' | 'after'; count: number } | null>(null);
  const [captured, setCaptured] = useState<(CaptureSelection & { messageId: string }) | null>(null);

  const transcript = entry?.current;
  const settings = transcript?.settings;
  const provider = settings?.provider ?? null;
  const configured = provider !== null && configuredProviders.includes(provider);
  const list = provider && configured ? models(provider) : undefined;
  const model = settings?.model ? list?.find(m => m.id === settings.model) : undefined;
  const listLoaded = list !== undefined;
  const loadError = provider && configured ? modelsError?.(provider) ?? null : null;

  const fetchModels = useCallback((p: ProviderId, refresh = false) => {
    setLoadingModels(true);
    void loadModels(p, refresh).finally(() => setLoadingModels(false));
  }, [loadModels]);

  // Loads once per provider; a failure waits for Retry instead of looping.
  useEffect(() => {
    if (aiEnabled && provider && configured && !listLoaded && !loadError) fetchModels(provider);
  }, [aiEnabled, provider, configured, listLoaded, loadError, fetchModels]);

  // The estimate mirrors buildChatRequest's text without rebuilding canon on every streamed delta.
  const canon = useMemo(() => (aiEnabled ? buildCanonText(items, bible) : ''), [aiEnabled, items, bible]);
  const attachmentIds = settings?.attachments;
  const attached = useMemo(
    () => (aiEnabled && attachmentIds?.length ? buildAttachmentsText(attachmentIds, items, contentOf, chatOf, item.id).text : ''),
    [aiEnabled, attachmentIds, items, contentOf, chatOf, item.id],
  );
  const systemLength = useMemo(
    () => systemText(settings?.systemPrompt ?? '', canon, attached).length,
    [settings?.systemPrompt, canon, attached],
  );

  if (!entry || !transcript || !settings) {
    return <p className="p-6 text-sm text-content-muted">Loading…</p>;
  }

  // A chat whose file couldn't be read (damaged, or from a newer version) is never written from here.
  const writable = aiEnabled && !entry.problem;
  const setSettings = (patch: Partial<ChatSettings>) => {
    if (writable) onUpdate(t => updateSettings(t, patch));
    else if (patch.filterMode) setViewFilter(patch.filterMode);
  };
  const filterMode = (!writable && viewFilter) || settings.filterMode;
  const messages = transcript.messages;
  // A cited message stays visible whatever the filter.
  const shown = filterMode === 'all'
    ? messages
    : messages.filter(m => m.id === highlight?.messageId || (filterMode === 'user_only' ? m.role === 'user' : m.role === 'assistant'));
  const unavailable = listLoaded && settings.model !== null && !model;
  // Sending and resubmitting both need a model listed for a configured provider.
  const canRun = writable && !streaming && model !== undefined;
  const canSend = canRun && composer.trim() !== '';
  // About four characters per token, as estimateTokens counts.
  const tokens = aiEnabled ? Math.ceil((systemLength + historyOf(messages).reduce((n, m) => n + m.text.length, 0)) / 4) : 0;
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
        editable={writable}
        configuredProviders={configuredProviders}
        models={list}
        model={model}
        modelsLoading={loadingModels}
        modelsError={loadError}
        onRefreshModels={() => provider && fetchModels(provider, true)}
        personaOpen={personaOpen}
        onTogglePersona={() => setPersonaOpen(o => !o)}
        attachmentsOpen={attachmentsOpen}
        onToggleAttachments={() => setAttachmentsOpen(o => !o)}
      />
      {writable && personaOpen && (
        <PersonaDrawer personaId={settings.personaId} systemPrompt={settings.systemPrompt} onChange={setSettings} onClose={() => setPersonaOpen(false)} />
      )}
      {writable && attachmentsOpen && (
        <AttachmentsPanel chatId={item.id} attachments={settings.attachments} items={items} onChange={(attachments) => setSettings({ attachments })} />
      )}

      {entry.problem && (
        <p role="alert" className="border-b border-line bg-surface-sunken px-4 py-2 text-xs text-danger">This chat file couldn&apos;t be read: {entry.problem}</p>
      )}
      {!aiEnabled && (
        <p role="note" className="border-b border-line bg-surface-sunken px-4 py-2 text-xs text-content-muted">Turn on AI in Settings to continue this chat.</p>
      )}
      {writable && unavailable && (
        <p role="alert" className="border-b border-line bg-surface-sunken px-4 py-2 text-xs text-warning">
          This chat&apos;s model is no longer available. Pick another model to continue.
        </p>
      )}
      {writable && streamError && (
        <p role="alert" aria-label="Chat error" className="border-b border-line bg-surface-sunken px-4 py-2 text-xs text-danger">{streamError}</p>
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
              {writable ? 'Ask a question about your story or research. The chat sees your kept canon and any attachments.' : 'This chat has no messages.'}
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
                highlight={highlight?.messageId === m.id ? highlight : null}
                onCapture={capture && ((sel) => setCaptured(c => (
                  c && c.messageId === m.id && c.start === sel.start && c.end === sel.end ? c : { ...sel, messageId: m.id }
                )))}
                actions={writable ? {
                  onSaveText: (text) => onUpdate(t => editMessageText(t, m.id, text)),
                  onSaveAndResubmit: (text) => onResubmit(m.id, text),
                  onResubmit: () => onResubmit(m.id, undefined),
                  onDelete: () => onUpdate(t => deleteMessage(t, m.id)),
                  onDeleteBefore: () => setConfirm({ messageId: m.id, side: 'before', count: index }),
                  onDeleteAfter: () => setConfirm({ messageId: m.id, side: 'after', count: countAfter }),
                  countBefore: index,
                  countAfter,
                  canSend: canRun,
                } : null}
              />
            );
          })}
        </div>
      </div>

      {writable && (
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

      {capture && (
        <CaptureHost
          itemId={item.id}
          messageId={captured?.messageId}
          parentId={item.parentId}
          items={capture.bible.items}
          bible={capture.bible.bible}
          updateBible={capture.bible.updateBible}
          addEntity={capture.addEntity}
          selection={captured}
          onClose={() => setCaptured(null)}
        />
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
