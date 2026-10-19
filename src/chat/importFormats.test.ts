import { describe, expect, it } from 'vitest';
import { exporterTurnSpans, formatTurns, hasTurnLayout, parseTranscript, turnSpans } from '@/chat/importFormats';
import { normalizeChatText } from '@/bible/entities';
import raw from './fixtures/aistudio-exporter-sample.md?raw';
import driveRaw from './fixtures/aistudio-drive-sample.json?raw';

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

  it('imports JSON that is not an AI Studio file as plain text', () => {
    expect(parseTranscript('{"a": 1}')).toMatchObject({ format: 'text', warnings: [] });
    expect(parseTranscript('{ not json')).toMatchObject({ format: 'text', warnings: [] });
  });
});

const drive = (chunks: unknown, extra: object = {}) => JSON.stringify({ runSettings: {}, chunkedPrompt: { chunks }, ...extra });

describe('parseTranscript: AI Studio Drive file', () => {
  it('reads turns, merging consecutive chunks of one role and dropping thinking', () => {
    const p = parseTranscript(driveRaw);
    expect(p.format).toBe('aistudio-drive');
    expect(p.title).toBeUndefined();
    expect(p.sourceUrl).toBeUndefined();
    expect(p.turns).toEqual([
      { role: 'user', label: 'You', text: '[Drive document not imported]\n\nHere is the story bible for Sky Harbour.' },
      { role: 'model', label: 'Gemini', text: 'A strong start. The **harbour** works as a hub.\n\n### Open questions\n\nWho runs it?' },
      { role: 'user', label: 'You', text: 'Make the harbour master a retired pilot named Odile.' },
      { role: 'model', label: 'Gemini', text: 'Odile fits well: a retired pilot who still reads the wind.' },
    ]);
    expect(p.warnings).toEqual(['1 attachment not imported (shown as a placeholder).']);
  });

  it('stores the canonical layout, whose turns are found again', () => {
    const p = parseTranscript(driveRaw);
    expect(p.body).toBe(formatTurns(p.turns));
    expect(turnSpans(p.body)!.map(s => p.body.slice(s.start, s.end))).toEqual(p.turns.map(t => t.text));
    expect(hasTurnLayout({ importedFormat: p.format })).toBe(true);
  });

  it('recognises CRLF + BOM input and normalizes line endings inside turns', () => {
    const p = parseTranscript('\uFEFF' + drive([{ role: 'user', text: 'a\r\nb' }]).replace(/,/g, ',\r\n'));
    expect(p.format).toBe('aistudio-drive');
    expect(p.turns[0].text).toBe('a\nb');
  });

  it('drops thought parts that appear inside an answer chunk', () => {
    const p = parseTranscript(drive([{ role: 'model', text: 'thinking...answer', parts: [{ text: 'thinking...', thought: true }, { text: 'answer' }] }]));
    expect(p.turns).toEqual([{ role: 'model', label: 'Gemini', text: 'answer' }]);
  });

  it('names each kind of attachment in its placeholder', () => {
    const p = parseTranscript(drive([
      { role: 'user', driveImage: { id: 'x' } },
      { role: 'user', inlineImage: { mimeType: 'image/png', data: '' } },
      { role: 'user', youtubeVideo: { id: 'y' } },
      { role: 'user', text: 'Look at these.' },
    ]));
    expect(p.turns[0].text).toBe('[image not imported]\n\n[image not imported]\n\n[attachment not imported]\n\nLook at these.');
    expect(p.warnings).toEqual(['3 attachments not imported (shown as placeholders).']);
  });

  it('skips empty chunks and chunks it cannot read, and says so', () => {
    const p = parseTranscript(drive([null, 'x', { role: 'narrator', text: 'Once' }, { role: 'user', text: '  ' }, { role: 'user', text: 'Hi' }]));
    expect(p.turns).toEqual([{ role: 'user', label: 'You', text: 'Hi' }]);
    expect(p.warnings).toEqual(['3 unreadable chunks skipped.']);
  });

  it('notes system instructions it did not import', () => {
    const p = parseTranscript(drive([{ role: 'user', text: 'Hi' }], { systemInstruction: { parts: [{ text: 'Be terse.' }] } }));
    expect(p.warnings).toEqual(["System instructions weren't imported."]);
  });

  it('falls back to plain text, with a warning, when no turns can be read', () => {
    for (const chunks of [undefined, 'nope', [], [{ role: 'model', isThought: true, text: 'hmm' }]]) {
      const text = drive(chunks);
      const p = parseTranscript(text);
      expect(p).toMatchObject({ format: 'text', turns: [], body: text });
      expect(p.warnings).toEqual(["This AI Studio file has no turns VRS could read; imported as plain text."]);
    }
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
