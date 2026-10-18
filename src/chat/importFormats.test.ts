import { describe, expect, it } from 'vitest';
import { exporterTurnSpans, formatTurns, parseTranscript, turnSpans } from '@/chat/importFormats';
import { normalizeChatText } from '@/bible/entities';
import raw from './fixtures/aistudio-exporter-sample.md?raw';

// The checkout may have CRLF line endings (core.autocrlf); the parser normalizes, the test regexes expect LF.
const sample = normalizeChatText(raw);

describe('parseTranscript: AI Chat Exporter markdown', () => {
  it('reads title, source and turns', () => {
    const p = parseTranscript(sample);
    expect(p.format).toBe('aistudio-exporter-md');
    expect(p.title).toBe('Sky Harbour Test Chat');
    expect(p.sourceUrl).toBe('https://aistudio.google.com/prompts/abc123');
    expect(p.turns.map(t => [t.role, t.label])).toEqual([['user', 'You'], ['model', 'Gemini'], ['user', 'You']]);
    expect(p.warnings).toEqual([]);
  });

  it('keeps markdown inside a turn and drops the stray Model line', () => {
    const g = parseTranscript(sample).turns[1].text;
    expect(g.startsWith('Model')).toBe(false);
    expect(g).toContain('### Inner heading');
    expect(g).toContain('\n---\n');
    expect(g.endsWith('---')).toBe(false);
  });

  it('drops the footer', () => {
    expect(parseTranscript(sample).turns[2].text).toBe('Make the harbour master a retired pilot named Odile.');
  });

  it('recognises CRLF + BOM input', () => {
    expect(parseTranscript('﻿' + sample.replace(/\n/g, '\r\n')).format).toBe('aistudio-exporter-md');
  });

  it('skips empty turns with a warning', () => {
    const p = parseTranscript(sample.replace(/(### 👤 User\n)[\s\S]*?(\n---\n\n### 🤖)/u, '$1\n$2'));
    expect(p.turns).toHaveLength(2);
    expect(p.warnings).toEqual(['1 empty turn skipped.']);
  });

  it('ignores a Source link that is not AI Studio', () => {
    expect(parseTranscript(sample.replace('https://aistudio.google.com/prompts/abc123', 'https://evil.example/x')).sourceUrl).toBeUndefined();
  });
});

describe('parseTranscript: fallback', () => {
  it('imports anything else as normalized plain text', () => {
    expect(parseTranscript('a\r\nb')).toEqual({ format: 'text', turns: [], body: 'a\nb', warnings: [] });
  });

  it('flags AI Studio Drive JSON as unsupported', () => {
    const p = parseTranscript(JSON.stringify({ chunkedPrompt: { chunks: [] } }));
    expect(p.format).toBe('text');
    expect(p.warnings[0]).toMatch(/Drive files aren't supported yet/);
  });
});

describe('canonical layout', () => {
  it('formats turns exactly', () => {
    expect(formatTurns([{ role: 'user', label: 'You', text: 'Hello' }, { role: 'model', label: 'Gemini', text: 'Hi there' }]))
      .toBe('=== You ===\n\nHello\n\n=== Gemini ===\n\nHi there\n');
  });

  it('escapes text lines that look like headings', () => {
    const body = formatTurns([{ role: 'model', label: 'Gemini', text: 'a\n=== Fake ===\nb' }]);
    expect(turnSpans(body)).toHaveLength(1);
    expect(body).toContain('\n === Fake ===\n');
  });

  it('turnSpans finds every turn with offsets into the body', () => {
    const p = parseTranscript(sample);
    const spans = turnSpans(p.body)!;
    expect(spans.map(s => s.role)).toEqual(['user', 'model', 'user']);
    expect(spans.map(s => s.label)).toEqual(['You', 'Gemini', 'You']);
    expect(p.body.slice(spans[0].headingStart, spans[0].headingEnd)).toBe('=== You ===');
    expect(p.body.slice(spans[1].start, spans[1].end)).toBe(p.turns[1].text);
    expect(p.body.slice(spans[2].start, spans[2].end)).toBe(p.turns[2].text);
  });

  it('turnSpans is null for text without headings', () => {
    expect(turnSpans('just text')).toBeNull();
  });
});

describe('exporterTurnSpans: raw exporter text stored before turn parsing existed', () => {
  it('finds each turn in place, matching what the parser would store', () => {
    const spans = exporterTurnSpans(sample)!;
    const parsed = parseTranscript(sample).turns;
    expect(spans.map(s => [s.role, s.label])).toEqual(parsed.map(t => [t.role, t.label]));
    expect(spans.map(s => sample.slice(s.start, s.end))).toEqual(parsed.map(t => t.text));
  });

  it('leaves the stray Model line and the --- separators outside the turn', () => {
    const [, model] = exporterTurnSpans(sample)!;
    const text = sample.slice(model.start, model.end);
    expect(text.startsWith('### Inner heading')).toBe(true);
    expect(text.endsWith('---')).toBe(false);
  });

  it('returns null for text without exporter turns', () => {
    expect(exporterTurnSpans('Just notes.\n### 👤 User\nno conversation heading')).toBeNull();
    expect(exporterTurnSpans(formatTurns([{ role: 'user', label: 'You', text: 'Hi' }]))).toBeNull();
  });
});
