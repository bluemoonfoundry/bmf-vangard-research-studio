import { useMemo } from 'react';
import { renderMarkdown } from '@/workspace/markdown';

interface MarkdownViewProps {
  text: string;
  /** Opens http(s) links in the system browser; every other link is ignored. */
  onOpenLink(url: string): void;
  className?: string;
  empty?: string;
}

/** Sanitized Markdown. Links never navigate the app window. */
export function MarkdownView({ text, onOpenLink, className = '', empty = 'Nothing written yet.' }: MarkdownViewProps) {
  const html = useMemo(() => renderMarkdown(text), [text]);
  if (!text.trim()) return <p className="py-6 text-sm italic text-content-muted">{empty}</p>;
  return (
    <div
      className={`markdown-body ${className}`}
      onClick={(e) => {
        const anchor = (e.target as HTMLElement).closest('a');
        if (!anchor) return;
        e.preventDefault();
        const href = anchor.getAttribute('href') ?? '';
        if (/^https?:\/\//i.test(href)) onOpenLink(href);
      }}
      // Safe: renderMarkdown sanitizes with DOMPurify.
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
