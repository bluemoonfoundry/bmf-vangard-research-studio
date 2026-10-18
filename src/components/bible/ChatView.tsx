import { useEffect, useRef } from 'react';

export interface ChatSelection { start: number; end: number; quote: string; rect: DOMRect }

export interface ChatViewProps {
  text: string;
  /** Accessible name of the transcript box. */
  label?: string;
  highlight?: { start: number; end: number } | null;
  onSelectRange?(r: ChatSelection): void;
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
  useEffect(() => {
    markRef.current?.scrollIntoView?.({ block: 'center' });
  }, [hStart, h?.end]);

  return (
    <pre
      ref={pre}
      aria-label={label}
      className="whitespace-pre-wrap break-words rounded-md border border-line bg-surface-raised p-4 font-mono text-xs leading-relaxed"
    >
      {h ? (
        <>
          {text.slice(0, h.start)}
          <mark ref={markRef}>{text.slice(h.start, h.end)}</mark>
          {text.slice(h.end)}
        </>
      ) : text}
    </pre>
  );
}
