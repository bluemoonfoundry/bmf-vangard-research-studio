import { describe, expect, it } from 'vitest';
import type { Bible, Fact, TreeItem } from '@/project/types';
import { emptyBible } from '@/bible/normalize';
import { formatTurns } from '@/chat/importFormats';
import { emptyExtraction } from '@/extraction/types';
import { extractionSource } from '@/extraction/sourceText';
import {
  buildExtractRequest, cacheKey, CANON_CAP_CHARS, EXTRACTION_PROMPT_VERSION, EXTRACTION_SYSTEM, extractionCanon, sourceBudgetChars,
} from '@/extraction/request';
import { cardFingerprint } from '@/extraction/apply';

const ent = (id: string, title: string, entityKind = 'character'): TreeItem =>
  ({ id, parentId: null, type: 'entity', entityKind, title, order: 0, keywords: [] });
const fact = (id: string, entityId: string, attribute: string, value: string, status: Fact['status'] = 'kept'): Fact =>
  ({ id, entityId, attribute, value, status, origin: 'manual', createdAt: 'T', updatedAt: 'T' });
const bibleOf = (facts: Fact[]): Bible => ({ ...emptyBible(), facts });

describe('extractionCanon', () => {
  const items = [ent('e1', 'Mara'), ent('e2', 'Sky Harbour', 'location')];

  it('lists entity ids, kinds, attribute names, live values and rejected values', () => {
    const bible = bibleOf([
      fact('f1', 'e1', 'Eyes', 'green'),
      fact('f2', 'e1', 'eyes', 'brown', 'proposed'),
      fact('f3', 'e1', 'eyes', 'grey', 'set_aside'),
    ]);
    const canon = extractionCanon(items, bible, emptyExtraction(), '');
    expect(canon).toContain('id: e1 · Mara (character)');
    expect(canon).toContain('id: e2 · Sky Harbour (location)');
    expect(canon).toContain('- Eyes: green [kept]; brown [proposed]');
    expect(canon).toContain('- rejected: eyes: grey');
    expect(canon).toContain('character: Eyes');
  });

  it('lists pending and rejected new cards', () => {
    const extraction = {
      ...emptyExtraction(),
      cards: [{ id: 'c1', kind: 'faction' as const, title: 'Pilots Guild', reason: '', createdAt: 'T' }],
      rejections: [{ fingerprint: cardFingerprint('character', 'Ivo'), label: 'New card: Ivo', at: 'T' }],
    };
    const canon = extractionCanon(items, emptyBible(), extraction, '');
    expect(canon).toContain('Pilots Guild (faction)');
    expect(canon).toContain('ivo (character)');
  });

  it('keeps only entities named in the source when the canon is too long', () => {
    const many = Array.from({ length: 400 }, (_, i) => ent(`x${i}`, `Person ${i} ${'z'.repeat(100)}`));
    const all = [...items, ...many];
    const full = extractionCanon(all, emptyBible(), emptyExtraction(), 'Mara spoke.');
    expect(full.length).toBeLessThanOrEqual(CANON_CAP_CHARS);
    expect(full).toContain('Mara');
    expect(full).not.toContain('Person 1 ');
  });

  it('says so when nothing is established', () => {
    expect(extractionCanon([], emptyBible(), emptyExtraction(), '')).toBe('(Nothing is established yet.)');
  });
});

describe('buildExtractRequest', () => {
  const body = formatTurns([{ role: 'user', label: 'You', text: 'Mara has green eyes.' }, { role: 'model', label: 'Gemini', text: 'Lovely.' }]);
  const src = extractionSource({ id: 's1', parentId: null, type: 'chat', title: 'Harbour chat', order: 0, keywords: [] }, body, undefined)!;

  it('carries the canon and the numbered source text', () => {
    const req = buildExtractRequest({ provider: 'gemini', model: 'm', canon: 'CANON', source: src, chunk: src.turns, chunkIndex: 0, chunkCount: 1, summary: 'ignored' });
    expect(req).toMatchObject({ provider: 'gemini', model: 'm', system: EXTRACTION_SYSTEM });
    expect(req.text).toContain('CANON');
    expect(req.text).toContain('[Turn 1 · You]\nMara has green eyes.');
    expect(req.text).toContain('Harbour chat');
    expect(req.text).not.toContain('ignored');
  });

  it('adds the running summary and the part number when chunked', () => {
    const req = buildExtractRequest({ provider: 'gemini', model: 'm', canon: '', source: src, chunk: [src.turns[1]], chunkIndex: 1, chunkCount: 3, summary: 'Mara: green eyes.' });
    expect(req.text).toContain('part 2 of 3');
    expect(req.text).toContain('Mara: green eyes.');
  });

  it('tells the model how to judge strength and to reuse wording', () => {
    for (const phrase of ['said', 'built_on', 'suggested', 'exact wording', 'replaces', 'season']) expect(EXTRACTION_SYSTEM).toContain(phrase);
  });
});

describe('sourceBudgetChars', () => {
  it('leaves headroom in the model limit, or assumes 100k tokens', () => {
    expect(sourceBudgetChars(undefined, 0)).toBe(240_000);
    expect(sourceBudgetChars(1_000_000, 10_000)).toBe(2_390_000);
    expect(sourceBudgetChars(1_000, 50_000)).toBe(4_000);
  });
});

describe('cacheKey', () => {
  it('is stable and changes with the text, provider or model', () => {
    const k = cacheKey('text', 'gemini', 'm');
    expect(cacheKey('text', 'gemini', 'm')).toBe(k);
    expect(cacheKey('text!', 'gemini', 'm')).not.toBe(k);
    expect(cacheKey('text', 'openai', 'm')).not.toBe(k);
    expect(cacheKey('text', 'gemini', 'm2')).not.toBe(k);
    expect(k).toContain(`v${EXTRACTION_PROMPT_VERSION}:`);
  });
});
