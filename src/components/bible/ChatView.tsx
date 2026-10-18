import { Fragment, useEffect, useMemo, useRef, type ReactNode } from 'react';
import { turnSpans } from '@/chat/importFormats';

export interface ChatSelection { start: number; end: number; quote: string; rect: DOMRect }

export interface ChatViewProps {
  text: string;
  /** Accessible name of the transcript box. */
  label?: string;
  highlight?: { start: number; end: number } | null;
  onSelectRange?(r: ChatSelection): void;
}

const HEADING_CLASS = { user: 'font-semibold text-accent', model: 'font-semibold text-content-muted' } as const;

/**
 * Renders `text` with turn headings styled and the highlight marked. The rendered text content
 * is always exactly `text`, so selection offsets stay offsets into the stored body.
 */
function renderSegments(text: string, highlight: { start: number; end: number } | null, markRef: React.Ref<HTMLElement>): ReactNode {
  const headings = turnSpans(text) ?? [];
  const cuts = new Set([0, text.length]);
  for (const h of headings) { cuts.add(h.headingStart); cuts.add(h.headingEnd); }
  if (highlight) { cuts.add(highlight.start); cuts.add(highlight.end); }
  const points = [...cuts].sort((a, b) => a - b);
  const out: ReactNode[] = [];
  let marked = false;
  for (let i = 0; i + 1 < points.length; i++) {
    const [from, to] = [points[i], points[i + 1]];
    if (from === to) continue;
    let node: ReactNode = text.slice(from, to);
    const heading = headings.find(h => from >= h.headingStart && to <= h.headingEnd);
    if (heading) node = <span data-turn-heading={heading.role} className={HEADING_CLASS[heading.role]}>{node}</span>;
    if (highlight && from >= highlight.start && to <= highlight.end) {
      // The first piece of the highlight carries the ref, so scrolling lands on its start.
      node = <mark ref={marked ? undefined : markRef}>{node}</mark>;
      marked = true;
    }
    out.push(<Fragment key={from}>{node}</Fragment>);
  }
  return out;
}

/** A read-only chat transcript. Selection offsets are into `text`, exactly as stored. */
export function ChatView({ text, label = 'Chat transcript', highlight, onSelectRange }: ChatViewProps) {
  const pre = useRef<HTMLPreElement>(null);
  const markRef = useRef<HTMLElement>(null);
  const report = useRef(onSelectRange);
  report.current = onSelectRange;
  const listening = onSelectRange !== undefined;

  // A document-level listener, so a drag that ends outside the transcript is still seen.
  useEffect(() => {
    if (!listening) return;
    const reportSelection = () => {
      const el = pre.current;
      const sel = window.getSelection();
      if (!el || !sel || sel.rangeCount === 0 || sel.isCollapsed) return;
      const range = sel.getRangeAt(0);
      if (!el.contains(range.startContainer) || !el.contains(range.endContainer)) return;
      const before = document.createRange();
      before.selectNodeContents(el);
      before.setEnd(range.startContainer, range.startOffset);
      const start = before.toString().length;
      const quote = range.toString();
      if (!quote) return;
      const rect = range.getBoundingClientRect?.() ?? el.getBoundingClientRect();
      report.current?.({ start, end: start + quote.length, quote, rect });
    };
    document.addEventListener('mouseup', reportSelection);
    document.addEventListener('keyup', reportSelection);
    return () => {
      document.removeEventListener('mouseup', reportSelection);
      document.removeEventListener('keyup', reportSelection);
    };
  }, [listening]);

  const h = highlight && highlight.start >= 0 && highlight.end > highlight.start && highlight.end <= text.length ? highlight : null;
  const hStart = h?.start;
  const hEnd = h?.end;
  const segments = useMemo(
    () => renderSegments(text, hStart === undefined || hEnd === undefined ? null : { start: hStart, end: hEnd }, markRef),
    [text, hStart, hEnd],
  );
  useEffect(() => {
    markRef.current?.scrollIntoView?.({ block: 'center' });
  }, [hStart, h?.end]);

  return (
    <pre
      ref={pre}
      aria-label={label}
      className="whitespace-pre-wrap break-words rounded-md border border-line bg-surface-raised p-4 font-mono text-xs leading-relaxed"
    >
      {segments}
    </pre>
  );
}
