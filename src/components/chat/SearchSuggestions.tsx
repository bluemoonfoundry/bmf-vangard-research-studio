import { useEffect, useMemo, useRef } from 'react';
import { sanitizeSearchSuggestions } from '@/chat/searchSuggestions';

interface SearchSuggestionsProps {
  /** Gemini's `searchEntryPoint.renderedContent`. */
  html: string;
  onOpenLink(url: string): void;
}

/**
 * Gemini's Google Search suggestions chip. Rendered in an open shadow root so its own CSS stays scoped
 * (no iframe: the CSP keeps `frame-src 'none'`). Links open externally, never inside the app.
 */
export function SearchSuggestions({ html, onOpenLink }: SearchSuggestionsProps) {
  const host = useRef<HTMLDivElement>(null);
  const clean = useMemo(() => sanitizeSearchSuggestions(html), [html]);
  const open = useRef(onOpenLink);
  open.current = onOpenLink;

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const root = el.shadowRoot ?? el.attachShadow({ mode: 'open' });
    // Safe: sanitizeSearchSuggestions strips scripts, handlers and non-http(s) links.
    root.innerHTML = clean;
    const onClick = (e: Event) => {
      const a = (e.target as Element | null)?.closest?.('a[href]');
      if (!a) return;
      e.preventDefault();
      open.current(a.getAttribute('href') ?? '');
    };
    root.addEventListener('click', onClick);
    return () => root.removeEventListener('click', onClick);
  }, [clean]);

  if (!clean.trim()) return null;
  return <div ref={host} data-testid="search-suggestions" className="border-t border-line pt-1.5"
      // Containment keeps provider CSS (:host{position:fixed}, inline fixed) from overlaying the app.
      style={{ position: 'relative', overflow: 'hidden', contain: 'content' }}
    />;
}
