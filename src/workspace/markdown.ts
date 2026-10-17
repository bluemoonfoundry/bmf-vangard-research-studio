import { Marked } from 'marked';
import DOMPurify from 'dompurify';

const marked = new Marked({ gfm: true, async: false });

/**
 * Renders user-authored Markdown to HTML that is safe to inject: marked passes
 * raw HTML through, so the output always goes through DOMPurify.
 */
export function renderMarkdown(text: string): string {
  const html = marked.parse(text) as string;
  return DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
    // Forms and embeds have no business in a research note.
    FORBID_TAGS: ['form', 'input', 'button', 'textarea', 'select', 'iframe', 'object', 'embed', 'style'],
    FORBID_ATTR: ['style'],
  });
}
