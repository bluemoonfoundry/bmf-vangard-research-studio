import { describe, it, expect } from 'vitest';
import type { TreeItem } from '@/project/types';
import { ALL_SCOPES, findMatches, searchItems, snippetAround, wildcardToRegExp, type SearchOptions } from '@/workspace/search';
import { textStats, wordCount } from '@/workspace/stats';
import { generateDossier } from '@/workspace/dossier';
import { renderMarkdown } from '@/workspace/markdown';
import { itemType, labelOf } from '@/workspace/research';

const item = (id: string, extra: Partial<TreeItem> = {}): TreeItem =>
  ({ id, parentId: null, type: 'document', title: id, order: 0, keywords: [], ...extra });

describe('stats', () => {
  it('counts words, characters, paragraphs and lines', () => {
    expect(wordCount('  ')).toBe(0);
    expect(textStats('One two\n\nthree')).toEqual({
      words: 3, chars: 14, charsNoSpaces: 11, paragraphs: 2, lines: 3, readingMinutes: 1,
    });
    expect(textStats('').readingMinutes).toBe(0);
  });
});

describe('search', () => {
  const items = [
    item('a', { title: 'Harbour master', synopsis: 'Keeps the tide tables', keywords: ['Dover'], label: 'character' }),
    item('b', { title: 'Lighthouse', synopsis: '', keywords: ['coast'] }),
  ];
  const content: Record<string, string> = { a: 'The harbour master of Dover, 1684.', b: 'A tall tower near the harbour.' };
  const search = (options: Partial<SearchOptions>) =>
    searchItems(items, id => content[id], { query: '', mode: 'text', caseSensitive: false, scopes: ALL_SCOPES, label: 'all', ...options });

  it('needs every word in text mode, ignoring case by default', () => {
    const result = search({ query: 'HARBOUR dover' });
    expect(result.ok && result.hits.map(h => h.item.id)).toEqual(['a']);
  });

  it('reports which fields matched, with snippets and match counts', () => {
    const result = search({ query: 'harbour' });
    if (!result.ok) throw new Error(result.error);
    expect(result.hits.map(h => h.item.id)).toEqual(['a', 'b']);
    expect(result.hits[0].fields).toEqual({ title: true, synopsis: false, content: true, keywords: false });
    expect(result.hits[0].contentSnippet).toEqual({ before: 'The ', match: 'harbour', after: ' master of Dover, 1684.' });
    expect(result.totalMatches).toBe(3);
  });

  it('limits by scope, label and case', () => {
    expect(search({ query: 'harbour', scopes: { ...ALL_SCOPES, content: false } })).toMatchObject({ hits: [{ item: { id: 'a' } }] });
    expect(search({ query: 'harbour', label: 'character' })).toMatchObject({ hits: [{ item: { id: 'a' } }] });
    expect(search({ query: 'harbour', caseSensitive: true, scopes: { ...ALL_SCOPES, title: false } })).toMatchObject({ hits: [{ item: { id: 'a' } }, { item: { id: 'b' } }] });
    expect(search({ query: 'Harbour', caseSensitive: true, scopes: { ...ALL_SCOPES, content: false } })).toMatchObject({ hits: [{ item: { id: 'a' } }] });
  });

  it('supports wildcards and regular expressions, reporting bad patterns', () => {
    expect(search({ query: 'light*', mode: 'wildcard' })).toMatchObject({ hits: [{ item: { id: 'b' } }] });
    expect(search({ query: '\\d{4}', mode: 'regex' })).toMatchObject({ hits: [{ item: { id: 'a' } }] });
    expect(search({ query: '(', mode: 'regex' })).toMatchObject({ ok: false, error: expect.any(String) });
    expect(search({ query: '$', mode: 'regex' })).toMatchObject({ ok: true, hits: [] });
  });

  it('escapes regex characters in wildcard patterns', () => {
    expect(wildcardToRegExp('a.b?', false).test('axbc')).toBe(false);
    expect(wildcardToRegExp('a.b?', false).test('a.bc')).toBe(true);
  });

  it('never loops on zero-length matches', () => {
    expect(findMatches('aaa', /x*/g)).toEqual([]);
    expect(snippetAround('abc', /x*/g)).toBeNull();
  });
});

describe('dossier', () => {
  it('compiles items in binder order with nested headings, sources and live link titles', () => {
    const items = [
      item('f', { type: 'folder', title: 'People', order: 0 }),
      item('a', { parentId: 'f', title: 'Ada', synopsis: 'Navigator', label: 'character', status: 'in_progress', keywords: ['crew'],
        citations: [{ id: 'c', source: 'Ship log', year: '1684', quote: 'Fair winds' }],
        references: [{ id: 'r', targetId: 'b' }, { id: 'r2', targetId: 'gone' }] }),
      item('b', { title: 'Harbour', order: 1, type: 'webpage', url: 'https://example.org/h' }),
    ];
    const md = generateDossier('Saga', items, id => (id === 'a' ? 'Body of Ada' : ''), new Date(0));
    expect(md).toMatch(/^# Saga: research dossier/);
    expect(md.indexOf('## People')).toBeLessThan(md.indexOf('### Ada'));
    expect(md.indexOf('### Ada')).toBeLessThan(md.indexOf('## Harbour'));
    expect(md).toContain('**Type:** Document · **Label:** Character · **Status:** In progress · **Keywords:** crew');
    expect(md).toContain('> Navigator\n\nBody of Ada');
    expect(md).toContain('- **Ship log** (1684) "Fair winds"');
    expect(md).toContain('**See also:** Harbour\n');
    expect(md).toContain('**Source:** <https://example.org/h>');
  });

  it('survives a cycle in a corrupt tree', () => {
    const items = [item('x', { parentId: 'y' }), item('y', { parentId: 'x' }), item('r')];
    expect(generateDossier('P', items, () => '')).toContain('## r');
  });
});

describe('renderMarkdown', () => {
  it('renders Markdown', () => {
    expect(renderMarkdown('# Title\n\n**bold** and *it*')).toContain('<h1>Title</h1>');
    expect(renderMarkdown('**bold**')).toContain('<strong>bold</strong>');
  });

  it('strips script, event handlers and javascript: links', () => {
    const html = renderMarkdown('<script>alert(1)</script><img src=x onerror="alert(1)"><iframe src="https://e.vil"></iframe>');
    expect(html).not.toMatch(/<script|onerror|<iframe/i);
    const link = renderMarkdown('A [link](javascript:alert(1)) here');
    expect(link).toContain('<a');
    expect(link).not.toMatch(/javascript:/i);
  });
});

describe('research helpers', () => {
  it('shows unknown item types as documents and ignores unknown labels', () => {
    expect(itemType({ type: 'hologram' })).toBe('document');
    expect(labelOf(item('a', { label: 'toString' as never }))).toBeNull();
  });
});
