import { describe, expect, it } from 'vitest';
import { sanitizeSearchSuggestions } from '@/chat/searchSuggestions';

describe('sanitizeSearchSuggestions', () => {
  it('strips scripts and event handlers', () => {
    const out = sanitizeSearchSuggestions('<div onclick="x()"><script>alert(1)</script><a href="https://g.co" onmouseover="y()">q</a><iframe src="https://e.com"></iframe><form><input></form></div>');
    expect(out).not.toMatch(/script|onclick|onmouseover|iframe|<form|<input/i);
    expect(out).toContain('https://g.co');
  });

  it('keeps style tags', () => {
    const out = sanitizeSearchSuggestions('<style>.chip{color:red}</style><div class="chip">q</div>');
    expect(out).toContain('<style>');
    expect(out).toContain('.chip{color:red}');
  });

  it('drops javascript: links', () => {
    const out = sanitizeSearchSuggestions('<a href="javascript:alert(1)">a</a><a href="data:text/html,x">b</a><a href="http://ok.test/">c</a>');
    expect(out).not.toMatch(/javascript:|data:/i);
    expect(out).toContain('http://ok.test/');
  });

  it('does not alter the Markdown sanitizer config', async () => {
    const { renderMarkdown } = await import('@/workspace/markdown');
    sanitizeSearchSuggestions('<style>a{}</style>');
    expect(renderMarkdown('<style>a{}</style>hi')).not.toContain('<style');
  });
});
