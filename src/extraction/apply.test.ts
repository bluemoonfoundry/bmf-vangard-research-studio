import { describe, expect, it } from 'vitest';
import type { RawProposal } from '@/ai/types';
import type { Bible, Fact, TreeItem } from '@/project/types';
import { emptyBible } from '@/bible/normalize';
import { formatTurns } from '@/chat/importFormats';
import { findContradictions } from '@/bible/contradictions';
import { keepOne } from '@/bible/ops';
import { emptyExtraction, type ExtractionState } from '@/extraction/types';
import { extractionSource, type ExtractionSource } from '@/extraction/sourceText';
import { applyResults, cardFingerprint, fingerprint, parseWhen, rejectedFingerprints } from '@/extraction/apply';

const ent = (id: string, title: string, entityKind = 'character'): TreeItem =>
  ({ id, parentId: null, type: 'entity', entityKind, title, order: 0, keywords: [] });
const chatItem = (id = 's1', extra: Partial<TreeItem> = {}): TreeItem =>
  ({ id, parentId: null, type: 'chat', title: 'Chat', order: 0, keywords: [], ...extra });

const BODY = formatTurns([
  { role: 'user', label: 'You', text: 'Mara has green eyes.' },
  { role: 'model', label: 'Gemini', text: 'Maybe Mara was once a pilot. Or a smuggler. Ivo could be her brother.' },
  { role: 'user', label: 'You', text: 'Yes, Mara was a pilot, and she flies again in season 2, episode 3.' },
]);
const source = (item = chatItem(), body = BODY): ExtractionSource => extractionSource(item, body, undefined)!;

const proposal = (over: Partial<RawProposal> = {}): RawProposal => ({
  entity: { id: 'e1', name: 'Mara', kind: 'character', reason: '' },
  attribute: 'eyes', value: 'green', strength: 'said',
  evidence: [{ quote: 'Mara has green eyes.', turn: 1 }], replaces: '',
  ...over,
});

function ctx(over: { items?: TreeItem[]; bible?: Bible; extraction?: ExtractionState; source?: ExtractionSource } = {}) {
  let n = 0;
  return {
    items: over.items ?? [ent('e1', 'Mara'), chatItem()],
    bible: over.bible ?? emptyBible(),
    extraction: over.extraction ?? emptyExtraction(),
    source: over.source ?? source(),
    now: 'NOW',
    newId: () => `id${++n}`,
  };
}

describe('applyResults: placement', () => {
  it('turns a said proposal on an existing entity into a proposed AI fact with evidence', () => {
    const { bible, extraction, summary } = applyResults(ctx(), [proposal({ replaces: 'blue' })]);
    expect(bible.facts).toEqual([{
      id: 'id1', entityId: 'e1', attribute: 'eyes', value: 'green', status: 'proposed', origin: 'ai',
      source: { itemId: 's1', quote: 'Mara has green eyes.', start: 13, end: 33 },
      evidence: [{ source: { itemId: 's1', quote: 'Mara has green eyes.', start: 13, end: 33 }, strength: 'said' }],
      replaces: 'blue', createdAt: 'NOW', updatedAt: 'NOW',
    }]);
    expect(extraction).toEqual(emptyExtraction());
    expect(summary).toMatchObject({ facts: 1, merged: 0, suggested: 0, cards: 0, skipped: 0, dropped: 0 });
  });

  it('keeps a suggested proposal out of the bible, in the pending pile', () => {
    const p = proposal({ attribute: 'past', value: 'smuggler', strength: 'suggested', evidence: [{ quote: 'Or a smuggler.', turn: 2 }] });
    const { bible, extraction, summary } = applyResults(ctx(), [p]);
    expect(bible.facts).toEqual([]);
    expect(extraction.pending).toMatchObject([{ ref: { entityId: 'e1' }, attribute: 'past', value: 'smuggler', strength: 'suggested' }]);
    expect(summary.suggested).toBe(1);
  });

  it('parses when values into story positions and drops unparsable ones', () => {
    const items = [ent('ev1', 'Mara flies again', 'event'), chatItem()];
    const when = (value: string) => proposal({
      entity: { id: 'ev1', name: 'Mara flies again', kind: 'event', reason: '' }, attribute: 'when', value,
      evidence: [{ quote: 'she flies again in season 2, episode 3', turn: 3 }],
    });
    const ok = applyResults(ctx({ items }), [when('season 2, episode 3')]);
    expect(ok.bible.facts[0].value).toEqual({ season: 2, episode: 3 });
    const bad = applyResults(ctx({ items }), [when('later on')]);
    expect(bad.bible.facts).toEqual([]);
    expect(bad.summary.dropped).toBe(1);
  });
});

describe('applyResults: matching entities and cards', () => {
  it('matches an unknown id by title, ignoring case and spacing', () => {
    const { bible } = applyResults(ctx(), [proposal({ entity: { id: 'zz', name: '  mara ', kind: 'character', reason: '' } })]);
    expect(bible.facts[0].entityId).toBe('e1');
  });

  it('proposes a new card for an unknown entity, and groups its proposals', () => {
    const ivo = { id: '', name: 'Ivo', kind: 'character', reason: 'Recurring sibling' };
    const { bible, extraction, summary } = applyResults(ctx(), [
      proposal({ entity: ivo, attribute: 'relation', value: 'brother of Mara', strength: 'suggested', evidence: [{ quote: 'Ivo could be her brother.', turn: 2 }] }),
      proposal({ entity: { ...ivo, name: 'ivo' }, attribute: 'role', value: 'sibling', strength: 'suggested', evidence: [{ quote: 'Ivo could be her brother.', turn: 2 }] }),
    ]);
    expect(bible.facts).toEqual([]);
    expect(extraction.cards).toEqual([{ id: 'id1', kind: 'character', title: 'Ivo', reason: 'Recurring sibling', createdAt: 'NOW' }]);
    expect(extraction.pending.map(p => p.ref)).toEqual([{ cardId: 'id1' }, { cardId: 'id1' }]);
    expect(summary.cards).toBe(1);
  });

  it('attaches a cached card proposal to an entity that now has its title', () => {
    const items = [ent('e1', 'Mara'), ent('e9', 'Ivo'), chatItem()];
    const { extraction, bible } = applyResults(ctx({ items }), [proposal({ entity: { id: '', name: 'Ivo', kind: 'character', reason: '' }, evidence: [{ quote: 'Mara has green eyes.', turn: 1 }] })]);
    expect(extraction.cards).toEqual([]);
    expect(bible.facts[0].entityId).toBe('e9');
  });
});

describe('applyResults: strength rules', () => {
  it('downgrades said or built_on without a quote from the writer to suggested', () => {
    const p = proposal({ attribute: 'past', value: 'pilot', strength: 'built_on', evidence: [{ quote: 'Maybe Mara was once a pilot.', turn: 2 }] });
    const { bible, extraction } = applyResults(ctx(), [p]);
    expect(bible.facts).toEqual([]);
    expect(extraction.pending[0].strength).toBe('suggested');
  });

  it('keeps built_on when a later writer turn uses it', () => {
    const p = proposal({ attribute: 'past', value: 'pilot', strength: 'built_on', evidence: [
      { quote: 'Maybe Mara was once a pilot.', turn: 2 }, { quote: 'Yes, Mara was a pilot', turn: 3 },
    ] });
    const { bible } = applyResults(ctx(), [p]);
    expect(bible.facts[0].evidence?.map(e => e.strength)).toEqual(['built_on', 'built_on']);
  });

  it('treats a source without turns as suggested, or as said when it is the writer\'s own writing', () => {
    const doc = (extra: Partial<TreeItem> = {}) => source(chatItem('s1', { type: 'document', ...extra }), 'Mara has green eyes.');
    const p = proposal({ evidence: [{ quote: 'Mara has green eyes.', turn: 1 }] });
    const pasted = applyResults(ctx({ source: doc() }), [p]);
    expect(pasted.bible.facts).toEqual([]);
    expect(pasted.extraction.pending[0].strength).toBe('suggested');
    const own = applyResults(ctx({ source: doc({ ownWriting: true }) }), [proposal({ strength: 'suggested' })]);
    expect(own.bible.facts[0].evidence?.[0].strength).toBe('said');
  });
});

describe('applyResults: merging repeated evidence', () => {
  it('adds evidence to a live fact with the same value instead of a new fact', () => {
    const first = applyResults(ctx(), [proposal()]);
    const again = applyResults(ctx({ bible: first.bible }), [proposal({ value: ' Green ', evidence: [{ quote: 'Mara has green eyes.', turn: 1 }, { quote: 'Mara was a pilot', turn: 3 }] })]);
    expect(again.bible.facts).toHaveLength(1);
    expect(again.bible.facts[0].evidence).toHaveLength(2);
    expect(again.summary.merged).toBe(1);
  });

  it('applying the same results twice changes nothing the second time', () => {
    const results = [
      proposal(),
      proposal({ attribute: 'past', value: 'smuggler', strength: 'suggested', evidence: [{ quote: 'Or a smuggler.', turn: 2 }] }),
      proposal({ entity: { id: '', name: 'Ivo', kind: 'character', reason: '' }, attribute: 'relation', value: 'brother', strength: 'suggested', evidence: [{ quote: 'Ivo could be her brother.', turn: 2 }] }),
    ];
    const once = applyResults(ctx(), results);
    const twice = applyResults(ctx({ bible: once.bible, extraction: once.extraction }), results);
    expect(twice.bible).toBe(once.bible);
    expect(twice.extraction).toBe(once.extraction);
  });

  it('moves a pending suggestion into the fact when a writer turn later says it', () => {
    const suggested = applyResults(ctx(), [proposal({ attribute: 'past', value: 'pilot', strength: 'suggested', evidence: [{ quote: 'Maybe Mara was once a pilot.', turn: 2 }] })]);
    const said = applyResults(ctx({ bible: suggested.bible, extraction: suggested.extraction }), [
      proposal({ attribute: 'past', value: 'pilot', strength: 'said', evidence: [{ quote: 'Yes, Mara was a pilot', turn: 3 }] }),
    ]);
    expect(said.extraction.pending).toEqual([]);
    expect(said.bible.facts[0].evidence?.map(e => e.strength)).toEqual(['said', 'suggested']);
  });
});

describe('applyResults: rejections', () => {
  const kept = (value: string, status: Fact['status']): Fact => ({
    id: `f-${value}`, entityId: 'e1', attribute: 'eyes', value, status, origin: 'ai', createdAt: 'T', updatedAt: 'T',
    source: { itemId: 's1', quote: 'Mara has green eyes.', start: 13, end: 33 },
    evidence: [{ source: { itemId: 's1', quote: 'Mara has green eyes.', start: 13, end: 33 }, strength: 'said' }],
  });

  it('never re-proposes a value the writer set aside by hand', () => {
    const bible = { ...emptyBible(), facts: [kept('green', 'set_aside')] };
    expect(rejectedFingerprints(bible, emptyExtraction()).has(fingerprint('e1', 'Eyes', 'GREEN'))).toBe(true);
    const r = applyResults(ctx({ bible }), [proposal()]);
    expect(r.bible).toBe(bible);
    expect(r.summary.skipped).toBe(1);
  });

  it('a keep-one decision is not a rejection: same evidence is skipped, new evidence comes back', () => {
    let bible: Bible = { ...emptyBible(), facts: [kept('green', 'proposed'), { ...kept('blue', 'proposed'), id: 'f-blue' }] };
    const c = findContradictions(bible, new Set(['e1']))[0];
    bible = keepOne(bible, c, c.versions.findIndex(v => v.value === 'blue'), { id: 'd1', now: 'T' });
    expect(rejectedFingerprints(bible, emptyExtraction()).size).toBe(0);
    const same = applyResults(ctx({ bible }), [proposal()]);
    expect(same.bible).toBe(bible);
    const fresh = applyResults(ctx({ bible }), [proposal({ evidence: [{ quote: 'Mara was a pilot', turn: 3 }] })]);
    expect(fresh.bible.facts.filter(f => f.status === 'proposed').map(f => f.value)).toEqual(['green']);
  });

  it('skips stored rejections and rejected cards with their proposals', () => {
    const extraction: ExtractionState = {
      ...emptyExtraction(),
      rejections: [
        { fingerprint: fingerprint('e1', 'eyes', 'green'), label: 'eyes: green', at: 'T' },
        { fingerprint: cardFingerprint('character', 'Ivo'), label: 'New card: Ivo', at: 'T' },
      ],
    };
    const r = applyResults(ctx({ extraction }), [
      proposal(),
      proposal({ entity: { id: '', name: 'IVO', kind: 'character', reason: '' }, strength: 'suggested', evidence: [{ quote: 'Ivo could be her brother.', turn: 2 }] }),
    ]);
    expect(r.bible.facts).toEqual([]);
    expect(r.extraction).toBe(extraction);
    expect(r.summary.skipped).toBe(2);
  });
});

describe('applyResults: drops', () => {
  it('drops evidence that cannot be found, and the proposal when none is left', () => {
    const r = applyResults(ctx(), [
      proposal({ evidence: [{ quote: 'Mara has green eyes.', turn: 1 }, { quote: 'a paraphrase that is not there', turn: 1 }] }),
      proposal({ attribute: 'hair', value: 'red', evidence: [{ quote: 'Mara has red hair.', turn: 1 }] }),
    ]);
    expect(r.bible.facts).toHaveLength(1);
    expect(r.bible.facts[0].evidence).toHaveLength(1);
    expect(r.summary.dropped).toBe(1);
  });
});

describe('parseWhen', () => {
  it('reads story positions written out or abbreviated', () => {
    expect(parseWhen('Season 2, episode 3, order 1')).toEqual({ season: 2, episode: 3, order: 1 });
    expect(parseWhen('season 1')).toEqual({ season: 1 });
    expect(parseWhen('S3 E2 #4')).toEqual({ season: 3, episode: 2, order: 4 });
    expect(parseWhen('soon')).toBeNull();
    expect(parseWhen('season 0')).toBeNull();
  });
});
