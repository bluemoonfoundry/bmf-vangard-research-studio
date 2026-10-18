import { describe, expect, it } from 'vitest';
import type { TreeItem } from '@/project/types';
import type { ChatTranscript } from '@/chat/types';
import { formatTurns } from '@/chat/importFormats';
import { normalizeChatText } from '@/bible/entities';
import { chunkTurns, extractionSource, locateEvidence, sourceTextFor, type SourceTurn } from '@/extraction/sourceText';
import raw from '@/chat/fixtures/aistudio-exporter-sample.md?raw';

const exporterSample = normalizeChatText(raw);
const item = (type: string, id = 'src1', importedFormat?: string): TreeItem => ({ id, parentId: null, type, title: 'Source', order: 0, keywords: [], ...(importedFormat ? { importedFormat } : {}) });
const exported = (id = 'src1') => item('chat', id, 'aistudio-exporter-md');
const canonical = formatTurns([
  { role: 'user', label: 'You', text: 'Mara is the harbour master.\n\nShe has  green eyes.' },
  { role: 'model', label: 'Gemini', text: 'Perhaps she was a pilot.' },
  { role: 'user', label: 'You', text: 'Yes, a retired pilot.' },
]);
const chat: ChatTranscript = {
  version: 1,
  settings: { provider: 'gemini', model: 'm', personaId: null, systemPrompt: '', temperature: null, webSearch: false, readUrls: false, attachments: [], filterMode: 'all' },
  messages: [
    { id: 'm1', role: 'user', text: 'Who rules the harbour?', createdAt: 'T' },
    { id: 'm2', role: 'assistant', text: 'A council of pilots.', createdAt: 'T', model: 'gemini-2.5-flash' },
  ],
};

describe('extractionSource', () => {
  it('reads a canonical chat as turns with body offsets', () => {
    const src = extractionSource(exported(), canonical, undefined)!;
    expect(src.hasTurns).toBe(true);
    expect(src.turns.map(t => [t.index, t.role, t.label])).toEqual([[1, 'user', 'You'], [2, 'model', 'Gemini'], [3, 'user', 'You']]);
    for (const t of src.turns) expect(canonical.slice(t.offset, t.offset + t.text.length)).toBe(t.text);
  });

  it('finds turns in an older raw exporter import without changing the body', () => {
    const src = extractionSource(item('chat'), exporterSample, undefined)!;
    expect(src.hasTurns).toBe(true);
    expect(src.turns.map(t => t.role)).toEqual(['user', 'model', 'user']);
    const last = src.turns[2];
    expect(exporterSample.slice(last.offset, last.offset + last.text.length)).toBe('Make the harbour master a retired pilot named Odile.');
  });

  it('reads turn-like lines in a plain-text chat or document as text', () => {
    for (const source of [item('chat', 'src1', 'text'), item('chat'), item('document')]) {
      const src = extractionSource(source, canonical, undefined)!;
      expect(src.hasTurns).toBe(false);
      expect(src.turns).toEqual([{ index: 1, role: 'unknown', label: 'Text', text: canonical, offset: 0 }]);
    }
  });

  it('reads a document without turns as one unknown turn', () => {
    const src = extractionSource(item('document'), 'Notes about Mara.', undefined)!;
    expect(src.hasTurns).toBe(false);
    expect(src.turns).toEqual([{ index: 1, role: 'unknown', label: 'Text', text: 'Notes about Mara.', offset: 0 }]);
  });

  it('reads an AI Chat as one turn per message, with message ids', () => {
    const src = extractionSource(item('ai-chat'), undefined, chat)!;
    expect(src.hasTurns).toBe(true);
    expect(src.turns).toEqual([
      { index: 1, role: 'user', label: 'You', text: 'Who rules the harbour?', offset: 0, messageId: 'm1' },
      { index: 2, role: 'model', label: 'gemini-2.5-flash', text: 'A council of pilots.', offset: 0, messageId: 'm2' },
    ]);
  });

  it('is null while the source has not loaded', () => {
    expect(extractionSource(item('chat'), undefined, undefined)).toBeNull();
    expect(extractionSource(item('ai-chat'), undefined, undefined)).toBeNull();
  });
});

describe('sourceTextFor', () => {
  it('labels each turn with its number', () => {
    const src = extractionSource(item('ai-chat'), undefined, chat)!;
    expect(sourceTextFor(src.turns)).toBe('[Turn 1 · You]\nWho rules the harbour?\n\n[Turn 2 · gemini-2.5-flash]\nA council of pilots.');
  });
});

describe('locateEvidence', () => {
  const src = extractionSource(exported(), canonical, undefined)!;

  it('places an exact quote at body offsets', () => {
    const hit = locateEvidence(src, 'a retired pilot', 3)!;
    expect(canonical.slice(hit.source.start, hit.source.end)).toBe('a retired pilot');
    expect(hit.source).toMatchObject({ itemId: 'src1', quote: 'a retired pilot' });
    expect(hit.turn.index).toBe(3);
  });

  it('tolerates whitespace differences and stores the text as it is in the body', () => {
    const hit = locateEvidence(src, 'Mara is the harbour master. She has green eyes.', 1)!;
    expect(hit.source.quote).toBe('Mara is the harbour master.\n\nShe has  green eyes.');
    expect(canonical.slice(hit.source.start, hit.source.end)).toBe(hit.source.quote);
  });

  it('finds a quote cited with the wrong turn', () => {
    expect(locateEvidence(src, 'Perhaps she was a pilot.', 1)?.turn.index).toBe(2);
    expect(locateEvidence(src, 'Perhaps she was a pilot.', 0)?.turn.index).toBe(2);
  });

  it('drops a paraphrase', () => {
    expect(locateEvidence(src, 'Mara used to fly ships.', 1)).toBeNull();
  });

  it('gives AI Chat evidence a message id and message offsets', () => {
    const ai = extractionSource(item('ai-chat'), undefined, chat)!;
    expect(locateEvidence(ai, 'council of pilots', 2)!.source).toEqual({ itemId: 'src1', messageId: 'm2', quote: 'council of pilots', start: 2, end: 19 });
  });
});

describe('chunkTurns', () => {
  const turn = (index: number, size: number): SourceTurn => ({ index, role: 'user', label: 'You', text: 'x'.repeat(size), offset: 0 });
  const turns = [turn(1, 100), turn(2, 100), turn(3, 100)];

  it('keeps everything in one chunk when it fits', () => {
    expect(chunkTurns(turns, 10_000)).toEqual([turns]);
  });

  it('splits into consecutive chunks without splitting a turn', () => {
    const chunks = chunkTurns(turns, 250);
    expect(chunks.map(c => c.map(t => t.index))).toEqual([[1, 2], [3]]);
    for (const c of chunks) expect(sourceTextFor(c).length).toBeLessThanOrEqual(250);
  });

  it('gives an oversized turn a chunk of its own', () => {
    expect(chunkTurns([turn(1, 50), turn(2, 500), turn(3, 50)], 200).map(c => c.map(t => t.index))).toEqual([[1], [2], [3]]);
  });
});
