import createDOMPurify from 'dompurify';

/** A private instance, so this config never touches the one MarkdownView uses. */
let purify: ReturnType<typeof createDOMPurify> | null = null;

/**
 * Sanitizes Gemini's `searchEntryPoint.renderedContent` (HTML plus a <style> block) for display in a shadow root.
 * Scripts, event handlers, embeds and forms are removed; links keep `href` only when it is http or https.
 */
export function sanitizeSearchSuggestions(html: string): string {
  purify ??= createDOMPurify(window);
  return purify.sanitize(html, {
    ADD_TAGS: ['style'],
    // Without this a leading <style> is parsed into <head> and lost.
    FORCE_BODY: true,
    FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'form', 'input', 'button', 'textarea', 'select'],
    ALLOWED_URI_REGEXP: /^https?:/i,
    ALLOW_DATA_ATTR: false,
  });
}
