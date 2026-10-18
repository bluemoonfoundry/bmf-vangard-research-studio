import { useState } from 'react';
import { ArrowDownToLine, ArrowUpToLine, Bot, Check, Copy, Loader2, Pencil, RotateCcw, Trash2, User } from 'lucide-react';
import { PROVIDERS } from '@/ai/types';
import type { ChatMessage } from '@/chat/types';
import { MarkdownView } from '@/components/workspace/MarkdownView';
import { btn, btnGhost, btnPrimary, input } from '@/components/workspace/ui';

export interface ChatMessageActions {
  onSaveText(text: string): void;
  onSaveAndResubmit(text: string): void;
  onResubmit(): void;
  onDelete(): void;
  onDeleteBefore(): void;
  onDeleteAfter(): void;
  /** Messages before and after this one (each "delete all" is disabled at 0). */
  countBefore: number;
  countAfter: number;
}

interface ChatMessageViewProps {
  message: ChatMessage;
  /** Actions are hidden in a read-only chat (AI off). */
  actions: ChatMessageActions | null;
  /** True while this chat streams: actions are disabled. */
  busy: boolean;
  onOpenLink(url: string): void;
}

const providerName = (id: string | null | undefined) => PROVIDERS.find(p => p.id === id)?.name ?? id ?? 'Unknown provider';

/** One transcript message: Markdown body, stamp, sources, status and actions. */
export function ChatMessageView({ message, actions, busy, onOpenLink }: ChatMessageViewProps) {
  const [draft, setDraft] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const isUser = message.role === 'user';
  const streaming = message.status === 'streaming';

  const copy = () => {
    void navigator.clipboard?.writeText(message.text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }, () => {});
  };
  const finishEdit = (save: (text: string) => void) => {
    if (draft === null) return;
    save(draft);
    setDraft(null);
  };

  return (
    <article
      aria-label={`${isUser ? 'You' : 'AI'}: ${message.text.slice(0, 80)}`}
      className={`flex flex-col gap-2 rounded-lg border p-3 ${isUser ? 'border-line bg-surface-raised' : 'border-line bg-surface'}`}
    >
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-line pb-1.5 text-[11px] text-content-muted">
        <div className="flex min-w-0 items-center gap-2">
          {isUser ? <User className="h-3.5 w-3.5 text-accent" aria-hidden /> : <Bot className="h-3.5 w-3.5 text-accent" aria-hidden />}
          <span className="font-semibold text-content">{isUser ? 'You' : 'AI'}</span>
          {!isUser && message.model && (
            <span className="rounded border border-line bg-surface-sunken px-1.5 py-0.5 font-mono text-[10px]">
              {`${providerName(message.provider)} · ${message.model}`}
            </span>
          )}
          {message.edited && <span className="italic">edited</span>}
          {message.status === 'cancelled' && <span className="rounded bg-surface-sunken px-1.5 py-0.5 text-warning">Stopped</span>}
          {streaming && (
            <span className="inline-flex items-center gap-1" role="status">
              <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> Replying…
            </span>
          )}
        </div>
        {actions && draft === null && (
          <div className="flex items-center gap-0.5">
            <button type="button" className={btnGhost} aria-label="Copy" title="Copy" onClick={copy}>
              {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
            </button>
            {isUser && (
              <>
                <button type="button" className={btnGhost} aria-label="Edit" title="Edit" disabled={busy} onClick={() => setDraft(message.text)}>
                  <Pencil className="h-3.5 w-3.5" />
                </button>
                <button type="button" className={btnGhost} aria-label="Resubmit" title="Resubmit (drops every later message)" disabled={busy} onClick={actions.onResubmit}>
                  <RotateCcw className="h-3.5 w-3.5" />
                </button>
              </>
            )}
            <button type="button" className={btnGhost} aria-label="Delete message" title="Delete message" disabled={busy} onClick={actions.onDelete}>
              <Trash2 className="h-3.5 w-3.5" />
            </button>
            <button type="button" className={btnGhost} aria-label="Delete all before" title="Delete all before" disabled={busy || actions.countBefore === 0} onClick={actions.onDeleteBefore}>
              <ArrowUpToLine className="h-3.5 w-3.5" />
            </button>
            <button type="button" className={btnGhost} aria-label="Delete all after" title="Delete all after" disabled={busy || actions.countAfter === 0} onClick={actions.onDeleteAfter}>
              <ArrowDownToLine className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
      </header>

      {draft !== null && actions ? (
        <div className="flex flex-col gap-2">
          <textarea
            aria-label="Edit message"
            className={`${input} min-h-[5rem] w-full resize-y text-sm`}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
          />
          <div className="flex justify-end gap-2">
            <button type="button" className={btn} onClick={() => setDraft(null)}>Cancel</button>
            <button type="button" className={btn} onClick={() => finishEdit(actions.onSaveText)}>Save text only</button>
            <button type="button" className={btnPrimary} disabled={busy || !draft.trim()} onClick={() => finishEdit(actions.onSaveAndResubmit)}>
              Save &amp; resubmit
            </button>
          </div>
        </div>
      ) : streaming && !message.text ? null : (
        <MarkdownView text={message.text} onOpenLink={onOpenLink} className="text-sm" empty={isUser ? '(empty message)' : 'No answer text.'} />
      )}

      {message.status === 'error' && message.error && (
        <p role="alert" className="rounded border border-danger p-2 text-xs text-danger">{message.error.message}</p>
      )}

      {message.sources && message.sources.length > 0 && (
        <div className="flex flex-col gap-1 border-t border-line pt-1.5 text-xs">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-content-muted">Sources</span>
          <ul className="flex flex-col gap-0.5">
            {message.sources.map(s => (
              <li key={s.url}>
                <a
                  href={s.url}
                  className="text-accent hover:underline"
                  title={s.url}
                  onClick={(e) => {
                    e.preventDefault();
                    onOpenLink(s.url);
                  }}
                >
                  {s.title || s.url}
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}
    </article>
  );
}
