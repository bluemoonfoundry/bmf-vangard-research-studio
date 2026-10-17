import { useRef } from 'react';

export interface ChatViewProps {
  text: string;
  highlight?: { start: number; end: number } | null;
  onSelectRange?(r: { start: number; end: number; quote: string }): void;
}

/** A read-only chat transcript. Selection offsets are into `text`, exactly as stored. */
export function ChatView({ text, highlight, onSelectRange }: ChatViewProps) {
  const pre = useRef<HTMLPreElement>(null);

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
    onSelectRange?.({ start, end: start + quote.length, quote });
  };

  const h = highlight && highlight.start >= 0 && highlight.end > highlight.start && highlight.end <= text.length ? highlight : null;

  return (
    <pre
      ref={pre}
      aria-label="Chat transcript"
      className="whitespace-pre-wrap break-words rounded-md border border-line bg-surface-raised p-4 font-mono text-xs leading-relaxed"
      onMouseUp={onSelectRange ? reportSelection : undefined}
      onKeyUp={onSelectRange ? reportSelection : undefined}
    >
      {h ? (
        <>
          {text.slice(0, h.start)}
          <mark>{text.slice(h.start, h.end)}</mark>
          {text.slice(h.end)}
        </>
      ) : text}
    </pre>
  );
}
