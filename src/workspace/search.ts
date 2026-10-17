import type { LabelId, TreeItem } from '@/project/types';

/** Binder search: plain words, wildcards (* and ?), or a JavaScript regular expression. */

export type SearchMode = 'text' | 'wildcard' | 'regex';

export interface SearchScopes {
  title: boolean;
  synopsis: boolean;
  content: boolean;
  keywords: boolean;
}

export const ALL_SCOPES: SearchScopes = { title: true, synopsis: true, content: true, keywords: true };

export interface SearchOptions {
  query: string;
  mode: SearchMode;
  caseSensitive: boolean;
  scopes: SearchScopes;
  label: LabelId | 'all';
}

export interface Snippet {
  before: string;
  match: string;
  after: string;
}

export interface SearchHit {
  item: TreeItem;
  fields: { title: boolean; synopsis: boolean; content: boolean; keywords: boolean };
  matches: number;
  synopsisSnippet: Snippet | null;
  contentSnippet: Snippet | null;
}

export type SearchResult =
  | { ok: true; hits: SearchHit[]; totalMatches: number; highlight: RegExp | null }
  | { ok: false; error: string };

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function wildcardToRegExp(pattern: string, caseSensitive: boolean): RegExp {
  const source = pattern.split('').map(ch => (ch === '*' ? '.*' : ch === '?' ? '.' : escapeRegExp(ch))).join('');
  return new RegExp(source, caseSensitive ? 'g' : 'gi');
}

/** Matches of a global regex, skipping zero-length matches so `a*` can't loop forever. */
export function findMatches(text: string, regex: RegExp, limit = Infinity): RegExpExecArray[] {
  const found: RegExpExecArray[] = [];
  regex.lastIndex = 0;
  let match: RegExpExecArray | null;
  while (found.length < limit && (match = regex.exec(text)) !== null) {
    if (match[0].length === 0) {
      regex.lastIndex++;
      continue;
    }
    found.push(match);
  }
  regex.lastIndex = 0;
  return found;
}

export function snippetAround(text: string, regex: RegExp, before = 35, after = 55): Snippet | null {
  const [match] = findMatches(text, regex, 1);
  if (!match) return null;
  const start = match.index;
  const end = start + match[0].length;
  const from = Math.max(0, start - before);
  const to = Math.min(text.length, end + after);
  return {
    before: (from > 0 ? '…' : '') + text.slice(from, start),
    match: match[0],
    after: text.slice(end, to) + (to < text.length ? '…' : ''),
  };
}

/** Builds the highlight regex and a field matcher for a query, or an error for an invalid pattern. */
function compile({ query, mode, caseSensitive }: SearchOptions):
  { highlight: RegExp; matches: (text: string) => boolean } | { error: string } {
  const flags = caseSensitive ? 'g' : 'gi';
  if (mode === 'text') {
    const terms = query.split(/\s+/).filter(Boolean);
    const fold = (t: string) => (caseSensitive ? t : t.toLowerCase());
    return {
      highlight: new RegExp(terms.map(escapeRegExp).join('|'), flags),
      // Every word must appear somewhere in the field.
      matches: (text) => terms.every(term => fold(text).includes(fold(term))),
    };
  }
  let highlight: RegExp;
  try {
    highlight = mode === 'regex' ? new RegExp(query, flags) : wildcardToRegExp(query, caseSensitive);
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
  return { highlight, matches: (text) => findMatches(text, highlight, 1).length > 0 };
}

/**
 * Searches binder items. `contentOf` returns an item's body text (possibly
 * unsaved), or undefined while it's still loading.
 */
export function searchItems(items: TreeItem[], contentOf: (id: string) => string | undefined, options: SearchOptions): SearchResult {
  const query = options.query.trim();
  if (!query) return { ok: true, hits: [], totalMatches: 0, highlight: null };
  const compiled = compile({ ...options, query });
  if ('error' in compiled) return { ok: false, error: compiled.error };
  const { highlight, matches } = compiled;
  const { scopes, label } = options;
  const count = (text: string) => findMatches(text, highlight).length;

  const hits: SearchHit[] = [];
  let totalMatches = 0;
  for (const item of items) {
    if (label !== 'all' && item.label !== label) continue;
    const synopsis = item.synopsis ?? '';
    const content = contentOf(item.id) ?? '';
    const fields = {
      title: scopes.title && matches(item.title),
      synopsis: scopes.synopsis && matches(synopsis),
      content: scopes.content && matches(content),
      keywords: scopes.keywords && item.keywords.some(matches),
    };
    if (!fields.title && !fields.synopsis && !fields.content && !fields.keywords) continue;

    let n = 0;
    if (scopes.title) n += count(item.title);
    if (scopes.synopsis) n += count(synopsis);
    if (scopes.content) n += count(content);
    if (scopes.keywords) n += item.keywords.reduce((sum, k) => sum + count(k), 0);
    const itemMatches = Math.max(1, n);
    totalMatches += itemMatches;
    hits.push({
      item,
      fields,
      matches: itemMatches,
      synopsisSnippet: fields.synopsis ? snippetAround(synopsis, highlight) : null,
      contentSnippet: fields.content ? snippetAround(content, highlight) : null,
    });
  }
  return { ok: true, hits, totalMatches, highlight };
}
