import { Fragment, useEffect, useRef, useState } from 'react';
import {
  Bold, Code, Eye, Heading1, Heading2, Italic, List, ListOrdered, Minus, Pencil, Quote, Upload,
} from 'lucide-react';
import type { EntityKind, MediaKind, TreeItem } from '@/project/types';
import type { AssetCache } from '@/workspace/assetCache';
import { itemType } from '@/workspace/research';
import { textStats } from '@/workspace/stats';
import { AudioPlayer, ImageViewer, WebClipBanner } from '@/components/workspace/MediaViews';
import { ChatView } from '@/components/bible/ChatView';
import { CaptureHost, type CaptureSelection } from '@/components/bible/CapturePopover';
import { EntityPanel, type EntityPanelProps } from '@/components/bible/EntityPanel';
import { MarkdownView } from '@/components/workspace/MarkdownView';
import { btn, btnGhost, segment, segmentGroup } from '@/components/workspace/ui';

export interface DocumentEditorProps {
  item: TreeItem;
  /** The body text, or undefined while it loads. */
  content: string | undefined;
  breadcrumbs: { id: string | null; title: string }[];
  assets: AssetCache | null;
  onNavigate(id: string | null): void;
  onChangeContent(id: string, content: string): void;
  onUpdate(id: string, patch: Partial<TreeItem>): void;
  onAttachMedia(item: TreeItem, kind: MediaKind): void;
  onOpenLink(url: string): void;
  /** Story Bible wiring; entity items show their facts above the body. */
  bible?: Omit<EntityPanelProps, 'entity'>;
  /** Creates an entity for a captured fact; returns its id. Capture is off without it. */
  addEntity?(kind: EntityKind, title: string, parentId: string | null): string;
  /** A passage to show: selected in the text box, or marked in a chat. */
  highlight?: { start: number; end: number } | null;
}

type Format = { label: string; icon: typeof Bold; before: string; after?: string; line?: boolean };

const FORMATS: (Format | 'divider')[] = [
  { label: 'Bold', icon: Bold, before: '**', after: '**' },
  { label: 'Italic', icon: Italic, before: '*', after: '*' },
  'divider',
  { label: 'Heading 1', icon: Heading1, before: '# ', line: true },
  { label: 'Heading 2', icon: Heading2, before: '## ', line: true },
  'divider',
  { label: 'Quote', icon: Quote, before: '> ', line: true },
  { label: 'Bulleted list', icon: List, before: '- ', line: true },
  { label: 'Numbered list', icon: ListOrdered, before: '1. ', line: true },
  { label: 'Inline code', icon: Code, before: '`', after: '`' },
  { label: 'Divider', icon: Minus, before: '\n---\n', line: true },
];

/**
 * The editor for one binder item: title, index-card synopsis, any media, and
 * the Markdown body with a sanitized preview. Mount it with `key={item.id}` so
 * per-document view state (preview, cursor) never leaks between items.
 */
export function DocumentEditor(props: DocumentEditorProps) {
  const { item, content, breadcrumbs, assets, onNavigate, onChangeContent, onUpdate, onAttachMedia, onOpenLink, bible, addEntity, highlight } = props;
  const [preview, setPreview] = useState(false);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const [capture, setCapture] = useState<CaptureSelection | null>(null);
  const fromTextarea = useRef(false);
  const appliedHighlight = useRef<unknown>(null);
  const stats = textStats(content ?? '');
  const type = itemType(item);
  const isChat = type === 'chat';
  const mediaKind: MediaKind | null = type === 'image' ? 'image' : type === 'audio' ? 'audio' : null;

  const canCapture = bible !== undefined && addEntity !== undefined;
  const closeCapture = () => {
    setCapture(null);
    const el = textarea.current;
    if (fromTextarea.current && el) el.setSelectionRange(el.selectionEnd, el.selectionEnd);
    fromTextarea.current = false;
  };
  const select = (r: CaptureSelection) =>
    setCapture(c => (c && c.start === r.start && c.end === r.end ? c : r));

  const captureFromTextarea = () => {
    const el = textarea.current;
    if (!canCapture || !el || content === undefined || el.selectionStart === el.selectionEnd) return;
    const { selectionStart: start, selectionEnd: end, value } = el;
    fromTextarea.current = true;
    // Textareas expose no caret rectangle, so the popover sits at the top of the box.
    select({ start, end, quote: value.slice(start, end), anchor: el.getBoundingClientRect() });
  };

  // Shows a passage opened from a fact's source: leave the preview, then select it in the text box.
  useEffect(() => {
    if (!highlight || isChat || content === undefined || appliedHighlight.current === highlight) return;
    if (preview) { setPreview(false); return; }
    const el = textarea.current;
    if (!el) return;
    appliedHighlight.current = highlight;
    el.focus();
    el.setSelectionRange(highlight.start, highlight.end);
  }, [highlight, isChat, content, preview]);

  // Uses this editor's own textarea: a split view can show two editors at once.
  const applyFormat = ({ before, after = '', line }: Format) => {
    const el = textarea.current;
    if (!el || content === undefined) return;
    const { selectionStart: start, selectionEnd: end } = el;
    const selected = content.slice(start, end);
    const atLineStart = !line || start === 0 || content[start - 1] === '\n';
    const prefix = atLineStart ? before : `\n${before}`;
    const body = selected || (line ? '' : 'text');
    onChangeContent(item.id, content.slice(0, start) + prefix + body + after + content.slice(end));
    requestAnimationFrame(() => {
      el.focus();
      const from = start + prefix.length;
      el.setSelectionRange(from, from + body.length);
    });
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex h-9 shrink-0 items-center justify-between gap-4 border-b border-line px-4 text-xs">
        <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1 text-content-muted">
          {breadcrumbs.map((crumb, i) => (
            <Fragment key={crumb.id ?? 'root'}>
              {i > 0 && <span aria-hidden>/</span>}
              <button
                type="button"
                className={`truncate hover:text-accent ${i === breadcrumbs.length - 1 ? 'font-semibold text-content' : ''}`}
                aria-current={i === breadcrumbs.length - 1 ? 'page' : undefined}
                onClick={() => onNavigate(crumb.id)}
              >
                {crumb.title || 'Untitled'}
              </button>
            </Fragment>
          ))}
        </nav>
        <span className="shrink-0 font-mono text-[11px] tabular-nums text-content-muted">
          {stats.words.toLocaleString()} words · {stats.chars.toLocaleString()} chars · ~{Math.max(1, stats.readingMinutes)} min
        </span>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-4xl flex-col gap-4 px-8 py-6">
          <div className="flex items-start gap-3">
            <input
              aria-label="Document title"
              className="min-w-0 flex-1 border-b border-transparent bg-transparent pb-1 font-serif text-2xl font-bold focus:border-accent focus:outline-none"
              value={item.title}
              placeholder="Untitled"
              onChange={(e) => onUpdate(item.id, { title: e.target.value })}
            />
            {!isChat && <div className={segmentGroup} role="group" aria-label="Editor mode">
              <button type="button" className={segment(!preview)} aria-pressed={!preview} onClick={() => setPreview(false)}>
                <Pencil className="h-3 w-3" /> Edit
              </button>
              <button type="button" className={segment(preview)} aria-pressed={preview} onClick={() => setPreview(true)}>
                <Eye className="h-3 w-3" /> Preview
              </button>
            </div>}
          </div>

          <label className="flex flex-col gap-1 rounded-md border border-line bg-surface-raised p-2.5">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-content-muted">Synopsis</span>
            <textarea
              aria-label="Synopsis"
              rows={2}
              value={item.synopsis ?? ''}
              placeholder="A short summary for the index card…"
              onChange={(e) => onUpdate(item.id, { synopsis: e.target.value })}
              className="resize-none bg-transparent text-xs leading-relaxed focus:outline-none"
            />
          </label>

          {mediaKind && (
            item.asset ? (
              <div className="flex flex-col gap-2">
                {mediaKind === 'image' ? <ImageViewer item={item} assets={assets} /> : <AudioPlayer item={item} assets={assets} />}
                <div className="flex justify-end">
                  <button type="button" className={btn} onClick={() => onAttachMedia(item, mediaKind)}>
                    <Upload className="h-3.5 w-3.5" /> Replace file…
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-between gap-3 rounded-lg border border-dashed border-line p-4 text-xs text-content-muted">
                <span>No {mediaKind} file attached.</span>
                <button type="button" className={btn} onClick={() => onAttachMedia(item, mediaKind)}>
                  <Upload className="h-3.5 w-3.5" /> Attach {mediaKind}…
                </button>
              </div>
            )
          )}
          {type === 'webpage' && <WebClipBanner item={item} onOpenLink={onOpenLink} />}

          {bible && item.type === 'entity' && <EntityPanel entity={item} {...bible} />}

          {!preview && !isChat && (
            <div className="flex flex-wrap items-center gap-0.5 border-y border-line py-1" role="toolbar" aria-label="Formatting">
              {FORMATS.map((f, i) => (f === 'divider'
                ? <span key={i} className="mx-1 h-4 w-px bg-line" aria-hidden />
                : (
                  <button
                    key={f.label}
                    type="button"
                    className={btnGhost}
                    aria-label={f.label}
                    title={f.label}
                    disabled={content === undefined}
                    onClick={() => applyFormat(f)}
                  >
                    <f.icon className="h-3.5 w-3.5" />
                  </button>
                )))}
            </div>
          )}

          {content === undefined ? (
            <p className="text-sm text-content-muted">Loading…</p>
          ) : isChat ? (
            <ChatView text={content} highlight={highlight} onSelectRange={canCapture ? (r) => { fromTextarea.current = false; select({ ...r, anchor: r.rect }); } : undefined} />
          ) : preview ? (
            <MarkdownView text={content} onOpenLink={onOpenLink} empty="Nothing written yet. Switch to Edit to start." />
          ) : (
            <textarea
              ref={textarea}
              aria-label="Document text"
              value={content}
              onChange={(e) => onChangeContent(item.id, e.target.value)}
              onMouseUp={captureFromTextarea}
              onKeyUp={captureFromTextarea}
              placeholder="Notes, excerpts, transcripts… Markdown works."
              className="min-h-[50vh] w-full resize-none bg-transparent text-sm leading-relaxed focus:outline-none"
            />
          )}
        </div>
      </div>
      {bible && addEntity && (
        <CaptureHost
          itemId={item.id}
          parentId={item.parentId}
          items={bible.items}
          bible={bible.bible}
          updateBible={bible.updateBible}
          addEntity={addEntity}
          selection={capture}
          onClose={closeCapture}
        />
      )}
    </div>
  );
}
