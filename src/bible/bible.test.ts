import { describe, expect, it } from 'vitest';
import type { Bible, Decision, Fact, StoryPosition, TreeItem } from '@/project/types';
import {
  comparePositions, emptyBible, formatAge, formatPosition, formatValue, isAgeAttribute, isDatedAge, isPosition, isWhenAttribute,
  normalizeText, positionsCompatible, specificity,
} from '@/bible/normalize';
import {
  addDependency, addFact, keepAll, keepOne, pruneOrphans, removeDependency, removeEntities, reopen, setFactStatus, updateFact,
} from '@/bible/ops';
import { checkPosition, eventsInCycles, keptPositions, strictlyAfter } from '@/bible/ordering';
import { storyBibleMarkdown } from '@/bible/exportMarkdown';
import { generateDossier } from '@/workspace/dossier';
import { buildTimeline } from '@/bible/timeline';
import { resolveSource, sourceText } from '@/bible/sources';
import type { ChatTranscript } from '@/chat/types';
import { eventsLinkingTo, factsCitingItems } from '@/bible/links';
import { normalizeChatText, entityKindOf, isEvent, ENTITY_KINDS, attributeSuggestions } from '@/bible/entities';
import { contradictionKey, findContradictions, groupVersions, openContradictions } from '@/bible/contradictions';
import { SOURCE_TYPES, appendSources, insertSources, isSourceItem, orderedSources, setSourceOrder } from '@/bible/sourceOrder';

let n = 0;
const fact = (over: Partial<Fact> = {}): Fact => ({
  id: `f${++n}`, entityId: 'e1', attribute: 'Death', value: 'x', status: 'kept', origin: 'manual',
  createdAt: 'T0', updatedAt: 'T0', ...over,
});
const bibleOf = (facts: Fact[], decisions: Decision[] = []): Bible => ({ facts, dependencies: [], decisions });
const pos = (season: number, episode?: number, order?: number): StoryPosition => ({ season, episode, order });

describe('normalize', () => {
  it('normalizes text', () => {
    expect(normalizeText('  Season\t 3 ')).toBe('season 3');
    expect(isWhenAttribute(' When ')).toBe(true);
    expect(isWhenAttribute('whence')).toBe(false);
  });
  it('checks position compatibility', () => {
    expect(positionsCompatible({ season: 3 }, { season: 3, episode: 4 })).toBe(true);
    expect(positionsCompatible({ season: 3, episode: 4 }, { season: 3, episode: 5 })).toBe(false);
  });
  it('orders positions with missing parts first', () => {
    const order = [pos(4), pos(3, 1, 2), pos(3), pos(3, 1)].sort(comparePositions);
    expect(order.map(formatPosition)).toEqual(['Season 3', 'S3 · E1', 'S3 · E1 · #2', 'Season 4']);
  });
  it('computes specificity, formatting and empty bible', () => {
    expect(specificity({ season: 1 })).toBe(0);
    expect(specificity({ season: 1, episode: 2 })).toBe(1);
    expect(specificity({ season: 1, episode: 2, order: 3 })).toBe(2);
    expect(formatPosition({ season: 3, episode: 4 })).toBe('S3 · E4');
    expect(emptyBible()).toEqual({ facts: [], dependencies: [], decisions: [] });
  });
  it('recognises and formats dated ages', () => {
    expect(isAgeAttribute(' Age ')).toBe(true);
    expect(isAgeAttribute('ages')).toBe(false);
    expect(isDatedAge({ age: 18, year: 12 })).toBe(true);
    expect(isDatedAge({ season: 1 })).toBe(false);
    expect(isDatedAge('18')).toBe(false);
    expect(isPosition({ age: 18, year: 12 })).toBe(false);
    expect(isPosition({ season: 1 })).toBe(true);
    expect(formatAge({ age: 18, year: 12 })).toBe('18 at year 12');
    expect(formatValue({ age: 6, year: 0 })).toBe('6 at year 0');
    expect(formatValue({ season: 2, episode: 3 })).toBe('S2 · E3');
    expect(formatValue('green')).toBe('green');
  });
});

describe('contradictions', () => {
  it('groups text values by normalized value', () => {
    const vs = groupVersions([fact({ value: 'Season 3' }), fact({ value: 'season  3' })]);
    expect(vs).toHaveLength(1);
    expect(vs[0].facts).toHaveLength(2);
    expect(vs[0].value).toBe('Season 3');
  });
  it('groups compatible positions under the most specific', () => {
    const vs = groupVersions([fact({ attribute: 'when', value: pos(3) }), fact({ attribute: 'when', value: pos(3, 4) })]);
    expect(vs).toHaveLength(1);
    expect(vs[0].value).toEqual(pos(3, 4));
    const vs2 = groupVersions([
      fact({ attribute: 'when', value: pos(3, 4) }), fact({ attribute: 'when', value: pos(3, 5) }),
      fact({ attribute: 'when', value: pos(3) }),
    ]);
    expect(vs2).toHaveLength(2);
  });
  const ents = new Set(['e1']);
  it('finds contradictions across attribute spellings', () => {
    const cs = findContradictions(bibleOf([
      fact({ attribute: 'Death ', value: 'a' }), fact({ attribute: 'death', value: 'b' }),
    ]), ents);
    expect(cs).toHaveLength(1);
    expect(cs[0].versions).toHaveLength(2);
    expect(cs[0].key).toBe(contradictionKey('e1', 'DEATH'));
    expect(openContradictions(cs)).toHaveLength(1);
  });
  it('ignores set_aside facts and unknown entities', () => {
    expect(findContradictions(bibleOf([fact({ value: 'a' }), fact({ value: 'b', status: 'set_aside' })]), ents)).toEqual([]);
    expect(findContradictions(bibleOf([fact({ value: 'a' }), fact({ value: 'b', entityId: 'gone' })]), ents)).toEqual([]);
  });
  it('acknowledges with a matching kept_all decision until a new fact appears', () => {
    const a = fact({ value: 'a' });
    const b = fact({ value: 'b' });
    const decision: Decision = {
      id: 'd1', entityId: 'e1', attribute: 'death', kind: 'kept_all',
      factIds: [b.id, a.id].sort(), setAsideIds: [], at: 'T1',
    };
    const [c] = findContradictions(bibleOf([a, b], [decision]), ents);
    expect(c.acknowledgedBy).toEqual(decision);
    expect(openContradictions([c])).toEqual([]);
    const [c2] = findContradictions(bibleOf([a, b, fact({ value: 'c' })], [decision]), ents);
    expect(c2.acknowledgedBy).toBeNull();
  });
  it('does not flag a proposed fact equal to the kept value', () => {
    expect(findContradictions(bibleOf([fact({ value: 'a' }), fact({ value: 'A', status: 'proposed' })]), ents)).toEqual([]);
  });
});

describe('ops', () => {
  const ents = new Set(['e1']);
  const two = () => {
    const a = fact({ id: 'a', value: 'alive' });
    const b = fact({ id: 'b', value: 'dead' });
    return { a, b, bible: bibleOf([a, b]) };
  };
  const decision = { id: 'd1', note: 'n', now: 'T1' };

  it('addFact, updateFact and setFactStatus are pure and stamp updatedAt', () => {
    const { bible } = two();
    const added = addFact(bible, fact({ id: 'c' }));
    expect(added.facts).toHaveLength(3);
    expect(bible.facts).toHaveLength(2);
    const upd = updateFact(bible, 'a', { value: 'zzz', note: 'hi' }, 'T9');
    expect(upd.facts[0]).toMatchObject({ value: 'zzz', note: 'hi', updatedAt: 'T9', id: 'a', createdAt: 'T0' });
    expect(bible.facts[0].value).toBe('alive');
    const st = setFactStatus(bible, 'b', 'set_aside', 'T9');
    expect(st.facts[1]).toMatchObject({ status: 'set_aside', updatedAt: 'T9' });
    expect(bible.facts[1].status).toBe('kept');
  });

  it('keepOne keeps the chosen version, sets the other aside and records a decision', () => {
    const { bible } = two();
    const c = findContradictions(bible, ents)[0];
    const idx = c.versions.findIndex(v => v.value === 'alive');
    const out = keepOne(bible, c, idx, decision);
    expect(out.facts.find(f => f.id === 'a')?.status).toBe('kept');
    expect(out.facts.find(f => f.id === 'b')?.status).toBe('set_aside');
    expect(out.decisions).toHaveLength(1);
    expect(out.decisions[0]).toMatchObject({
      id: 'd1', kind: 'kept_one', entityId: 'e1', attribute: 'Death', factIds: c.factIds, setAsideIds: ['b'], note: 'n', at: 'T1',
    });
    expect(findContradictions(out, ents)).toEqual([]);
    expect(bible.decisions).toHaveLength(0);
  });

  it('reopen restores set-aside facts and the contradiction reappears', () => {
    const { bible } = two();
    const c = findContradictions(bible, ents)[0];
    const out = reopen(keepOne(bible, c, 0, decision), 'd1', 'T2');
    expect(out.facts.map(f => f.status)).toEqual(['kept', 'kept']);
    expect(out.decisions).toEqual([]);
    expect(findContradictions(out, ents)).toHaveLength(1);
  });

  it('reopen does not restore a fact set aside before the decision', () => {
    const a = fact({ id: 'a', value: 'alive' });
    const b = fact({ id: 'b', value: 'dead' });
    const x = fact({ id: 'x', value: 'missing', status: 'set_aside' });
    const bible = bibleOf([a, b, x]);
    const c = findContradictions(bible, ents)[0];
    const out = reopen(keepOne(bible, c, 0, decision), 'd1', 'T2');
    expect(out.facts.find(f => f.id === 'x')?.status).toBe('set_aside');
  });

  it('keepAll twice on the same key leaves one decision', () => {
    const { bible } = two();
    const c = findContradictions(bible, ents)[0];
    const once = keepAll(bible, c, { id: 'd1', now: 'T1' });
    expect(findContradictions(once, ents)[0].acknowledgedBy?.id).toBe('d1');
    const twice = keepAll(once, c, { id: 'd2', now: 'T2' });
    expect(twice.decisions.map(d => d.id)).toEqual(['d2']);
    expect(twice.decisions[0].kind).toBe('kept_all');
  });

  it('addDependency ignores self and duplicate pairs; removeDependency removes', () => {
    const b0 = emptyBible();
    expect(addDependency(b0, { id: 'x', eventId: 'e', afterEventId: 'e' }).dependencies).toEqual([]);
    const b1 = addDependency(b0, { id: 'x', eventId: 'e', afterEventId: 'f' });
    expect(b1.dependencies).toHaveLength(1);
    expect(addDependency(b1, { id: 'y', eventId: 'e', afterEventId: 'f' }).dependencies).toHaveLength(1);
    expect(removeDependency(b1, 'x').dependencies).toEqual([]);
  });

  it('removeEntities keeps unknown top-level fields', () => {
    const b = { ...bibleOf([]), extra: 1 } as Bible;
    expect(removeEntities(b, new Set(['x']))).toMatchObject({ extra: 1 });
  });

  it('pruneOrphans drops facts, decisions and dependencies that reference missing entities', () => {
    const items = [ent('e1', 'One', 'event'), ent('e2', 'Two', 'event')];
    const b: Bible = {
      facts: [fact({ id: 'ok', entityId: 'e1' }), fact({ id: 'gone', entityId: 'zz' })],
      dependencies: [
        { id: 'd1', eventId: 'e1', afterEventId: 'e2' },
        { id: 'd2', eventId: 'e1', afterEventId: 'zz' },
        { id: 'd3', eventId: 'zz', afterEventId: 'e2' },
      ],
      decisions: [
        { id: 'k1', entityId: 'e1', attribute: 'x', kind: 'kept_all', factIds: [], setAsideIds: [], at: 'T' },
        { id: 'k2', entityId: 'zz', attribute: 'x', kind: 'kept_all', factIds: [], setAsideIds: [], at: 'T' },
      ],
    };
    const out = pruneOrphans(b, items);
    expect(out.facts.map(f => f.id)).toEqual(['ok']);
    expect(out.dependencies.map(d => d.id)).toEqual(['d1']);
    expect(out.decisions.map(d => d.id)).toEqual(['k1']);
  });

  it('pruneOrphans returns the same object when nothing is orphaned', () => {
    const items = [ent('e1', 'One', 'event')];
    const b = bibleOf([fact({ entityId: 'e1' })]);
    expect(pruneOrphans(b, items)).toBe(b);
  });

  it('removeEntities cascades but keeps facts that only cite a removed item', () => {
    const bible: Bible = {
      facts: [fact({ id: 'a', entityId: 'ev' }), fact({ id: 'b', entityId: 'other', source: { itemId: 'ev', quote: 'q', start: 0, end: 1 } })],
      dependencies: [
        { id: 'd1', eventId: 'ev', afterEventId: 'o' },
        { id: 'd2', eventId: 'o', afterEventId: 'ev' },
        { id: 'd3', eventId: 'o', afterEventId: 'p' },
      ],
      decisions: [
        { id: 'k1', entityId: 'ev', attribute: 'x', kind: 'kept_all', factIds: [], setAsideIds: [], at: 'T' },
        { id: 'k2', entityId: 'other', attribute: 'x', kind: 'kept_all', factIds: [], setAsideIds: [], at: 'T' },
      ],
    };
    const out = removeEntities(bible, new Set(['ev']));
    expect(out.facts.map(f => f.id)).toEqual(['b']);
    expect(out.dependencies.map(d => d.id)).toEqual(['d3']);
    expect(out.decisions.map(d => d.id)).toEqual(['k2']);
  });
});

const ent = (id: string, title: string, entityKind = 'event', refs: string[] = []): TreeItem => ({
  id, parentId: null, type: 'entity', title, order: 0, keywords: [], entityKind,
  references: refs.map((targetId, i) => ({ id: `r${i}`, targetId })),
});
const when = (entityId: string, value: StoryPosition, over: Partial<Fact> = {}): Fact =>
  fact({ entityId, attribute: 'when', value, ...over });
const dep = (id: string, eventId: string, afterEventId: string) => ({ id, eventId, afterEventId });

describe('ordering', () => {
  it('strictlyAfter', () => {
    expect(strictlyAfter({ season: 3 }, { season: 3, episode: 4 })).toBe('unknown');
    expect(strictlyAfter({ season: 5, episode: 2 }, { season: 4, episode: 1 })).toBe('yes');
    expect(strictlyAfter({ season: 2 }, { season: 3 })).toBe('no');
    expect(strictlyAfter({ season: 3, episode: 4 }, { season: 3, episode: 4 })).toBe('unknown');
    expect(strictlyAfter({ season: 3, episode: 4, order: 1 }, { season: 3, episode: 4, order: 1 })).toBe('no');
    expect(strictlyAfter({ season: 3, episode: 4, order: 2 }, { season: 3, episode: 4, order: 1 })).toBe('yes');
  });
  const mira = (): Bible => ({
    facts: [
      when('hal', { season: 3, episode: 4 }), when('ren', { season: 4, episode: 1 }),
      when('mira', { season: 3, episode: 10 }, { id: 'm1' }),
      when('mira', { season: 5, episode: 2 }, { id: 'm2', status: 'proposed' }),
    ],
    dependencies: [dep('d1', 'mira', 'hal'), dep('d2', 'ren', 'mira')],
    decisions: [],
  });
  it('keptPositions ignores proposed facts', () => {
    const b = mira();
    expect(keptPositions(b, 'mira')).toEqual([{ season: 3, episode: 10 }]);
    expect(keptPositions(b, 'nobody')).toEqual([]);
  });
  it('checkPosition on the Mira scenario', () => {
    const b = mira();
    expect(checkPosition(b, 'mira', { season: 3, episode: 10 }).map(c => c.result)).toEqual(['ok', 'ok']);
    const bad = checkPosition(b, 'mira', { season: 5, episode: 2 });
    expect(bad.find(c => c.direction === 'before')).toMatchObject({ otherEventId: 'ren', result: 'violated' });
    expect(bad.find(c => c.direction === 'after')?.result).toBe('ok');
    expect(checkPosition(b, 'hal', { season: 3, episode: 4 }).map(c => c.direction)).toEqual(['before']);
  });
  it('is unknown with no kept positions or mixed results', () => {
    const b: Bible = {
      facts: [when('x', { season: 1 }), when('x', { season: 9 }, { id: 'x2' })],
      dependencies: [dep('d', 'y', 'x'), dep('e', 'y', 'z')], decisions: [],
    };
    const r = checkPosition(b, 'y', { season: 5 });
    expect(r.find(c => c.otherEventId === 'z')?.result).toBe('unknown');
    expect(r.find(c => c.otherEventId === 'x')?.result).toBe('unknown');
  });
  it('detects cycles', () => {
    const b: Bible = { facts: [], dependencies: [dep('1', 'a', 'b'), dep('2', 'b', 'a'), dep('3', 'c', 'a')], decisions: [] };
    expect([...eventsInCycles(b)].sort()).toEqual(['a', 'b']);
  });
});

describe('timeline', () => {
  const items = [ent('a', 'Alpha'), ent('b', 'beta'), ent('c', 'Gamma'), ent('d', 'Delta'), ent('ch', 'Char', 'character')];
  it('places kept_all events once per version, with contested and unplaced lists', () => {
    let b: Bible = {
      facts: [
        when('a', { season: 1, episode: 1 }, { id: 'a1' }), when('a', { season: 2, episode: 1 }, { id: 'a2' }),
        when('b', { season: 1, episode: 1 }), when('c', { season: 1 }, { id: 'c1' }), when('c', { season: 2 }, { id: 'c2' }),
        when('d', { season: 7 }, { status: 'proposed' }), when('ch', { season: 1 }),
      ],
      dependencies: [], decisions: [],
    };
    const cs = findContradictions(b, new Set(['a', 'b', 'c', 'd', 'ch']));
    const aCs = cs.find(c => c.entityId === 'a');
    if (!aCs) throw new Error('expected a contradiction');
    b = keepAll(b, aCs, { id: 'dk', now: 'T1' });
    const t = buildTimeline(b, items);
    expect(t.contested).toEqual(['c']);
    expect(t.unplaced).toEqual(['d']);
    expect(t.placed.map(e => [e.eventId, e.versionIndex, e.versionCount])).toEqual([['a', 0, 2], ['b', 0, 1], ['a', 1, 2]]);
    expect(t.placed.some(e => e.eventId === 'ch')).toBe(false);
  });
  it('flags violations and cycles, and drops them when the event is removed', () => {
    const b: Bible = {
      facts: [when('a', { season: 1, episode: 1 }), when('b', { season: 3, episode: 1 })],
      dependencies: [dep('d1', 'a', 'b')], decisions: [],
    };
    expect(buildTimeline(b, items).placed.every(e => e.violated)).toBe(true);
    const cyc = buildTimeline({ ...b, dependencies: [dep('d1', 'a', 'b'), dep('d2', 'b', 'a')] }, items);
    expect(cyc.placed.every(e => e.inCycle)).toBe(true);
    const t2 = buildTimeline(removeEntities(b, new Set(['b'])), items);
    expect(t2.placed.some(e => e.violated)).toBe(false);
  });
});

describe('sources', () => {
  const src = { itemId: 'i', quote: 'the cat', start: 4, end: 11 };
  it('resolves exact, relocated, missing and deleted', () => {
    expect(resolveSource(src, 'See the cat sat', true)).toEqual({ status: 'exact', start: 4, end: 11 });
    expect(resolveSource(src, 'XXSee the cat sat', true)).toEqual({ status: 'relocated', start: 6, end: 13 });
    expect(resolveSource(src, 'no felines', true)).toEqual({ status: 'missing' });
    expect(resolveSource(src, 'See the cat', false)).toEqual({ status: 'deleted' });
    expect(resolveSource(src, undefined, false)).toEqual({ status: 'deleted' });
    expect(resolveSource(src, undefined, true)).toEqual({ status: 'exact', start: 4, end: 11 });
    expect(resolveSource({ ...src, quote: '' }, 'abc', true)).toEqual({ status: 'missing' });
  });
  it('relocates to the first occurrence of a repeated quote', () => {
    expect(resolveSource({ ...src, start: 20, end: 27 }, 'the cat ... the cat', true))
      .toEqual({ status: 'relocated', start: 0, end: 7 });
  });
  it('resolveSource: null body is missing', () => {
    expect(resolveSource(src, null, true)).toEqual({ status: 'missing', reason: 'message_deleted' });
    expect(resolveSource(src, null, false)).toEqual({ status: 'deleted' });
  });

  const chat = {
    version: 1,
    settings: {},
    messages: [
      { id: 'm1', role: 'user', text: 'Who is Mira?' },
      { id: 'm2', role: 'assistant', text: 'See the cat sat' },
    ],
  } as unknown as ChatTranscript;
  const bodyOf = (id: string) => (id === 'd' ? 'doc body' : undefined);
  const chatOf = (id: string) => (id === 'c' ? chat : undefined);

  it('sourceText reads the cited message', () => {
    expect(sourceText({ ...src, itemId: 'c', messageId: 'm2' }, bodyOf, chatOf)).toBe('See the cat sat');
    expect(resolveSource({ ...src, itemId: 'c', messageId: 'm2' }, sourceText({ ...src, itemId: 'c', messageId: 'm2' }, bodyOf, chatOf), true))
      .toEqual({ status: 'exact', start: 4, end: 11 });
    // Without a messageId the item's body is read, as before.
    expect(sourceText({ ...src, itemId: 'd' }, bodyOf, chatOf)).toBe('doc body');
    // A chat that hasn't loaded yet.
    expect(sourceText({ ...src, itemId: 'other', messageId: 'm2' }, bodyOf, chatOf)).toBeUndefined();
  });
  it('sourceText: deleted message → null', () => {
    const source = { ...src, itemId: 'c', messageId: 'gone' };
    expect(sourceText(source, bodyOf, chatOf)).toBeNull();
    expect(resolveSource(source, sourceText(source, bodyOf, chatOf), true)).toEqual({ status: 'missing', reason: 'message_deleted' });
  });
});

describe('links', () => {
  it('finds events linking to an entity in binder order', () => {
    const items = [
      ent('e2', 'Two', 'event', ['x']), ent('c', 'C', 'character', ['x']),
      ent('e1', 'One', 'event', ['x', 'y']), ent('e3', 'Three', 'event', ['y']),
    ];
    expect(eventsLinkingTo(items, 'x').map(i => i.id)).toEqual(['e2', 'e1']);
  });
  it('finds facts citing items', () => {
    const a = fact({ source: { itemId: 'i1', quote: 'q', start: 0, end: 1 } });
    const b = fact({ source: { itemId: 'i2', quote: 'q', start: 0, end: 1 } });
    expect(factsCitingItems(bibleOf([a, b, fact()]), new Set(['i1']))).toEqual([a]);
  });
});

describe('entities and chat text', () => {
  it('normalizes chat text to LF without a BOM', () => {
    expect(normalizeChatText('\uFEFFa\r\nb\rc')).toBe('a\nb\nc');
  });

  it('knows entity kinds and events', () => {
    const e = (entityKind?: string) => ({ type: 'entity', entityKind }) as TreeItem;
    expect(ENTITY_KINDS.map(k => k.id)).toEqual(['character', 'location', 'faction', 'item', 'lore', 'event', 'plotline']);
    expect(entityKindOf(e('event'))).toBe('event');
    expect(entityKindOf(e('weird'))).toBeNull();
    expect(entityKindOf({ type: 'document' } as TreeItem)).toBeNull();
    expect(isEvent(e('event'))).toBe(true);
    expect(isEvent(e('lore'))).toBe(false);
  });
});

describe('attributeSuggestions', () => {
  const items = [
    { id: 'c1', type: 'entity', entityKind: 'character' }, { id: 'c2', type: 'entity', entityKind: 'character' },
    { id: 'l1', type: 'entity', entityKind: 'location' }, { id: 'ev', type: 'entity', entityKind: 'event' },
  ] as TreeItem[];
  const b = bibleOf([
    fact({ entityId: 'c1', attribute: 'Eyes' }), fact({ entityId: 'c1', attribute: 'Death' }),
    fact({ entityId: 'c2', attribute: ' death ' }), fact({ entityId: 'l1', attribute: 'Climate' }),
  ]);

  it('lists attributes of that kind, most used first', () => {
    expect(attributeSuggestions(b, items, 'character')).toEqual(['Death', 'Eyes']);
    expect(attributeSuggestions(b, items, 'location')).toEqual(['Climate']);
  });
  it('adds when for events only', () => {
    expect(attributeSuggestions(b, items, 'event')).toEqual(['when']);
    expect(attributeSuggestions(b, items, 'lore')).toEqual([]);
  });
});

describe('storyBibleMarkdown', () => {
  const ent = (id: string, title: string, entityKind: string): TreeItem =>
    ({ id, parentId: null, type: 'entity', title, order: 0, keywords: [], entityKind }) as TreeItem;
  const items = [ent('mira', 'Mira', 'character'), ent('hal', 'Hal', 'event'), ent('dawn', 'Dawn', 'event'), ent('x', 'Odd', 'mystery')];
  const b = bibleOf([
    fact({ entityId: 'mira', attribute: 'Death', value: 'Season 3 finale' }),
    fact({ entityId: 'mira', attribute: 'Death', value: 'Pilot', status: 'proposed' }),
    fact({ entityId: 'mira', attribute: 'eyes', value: 'green' }),
    fact({ entityId: 'mira', attribute: 'Eyes', value: 'hazel' }),
    fact({ entityId: 'hal', attribute: 'when', value: pos(3, 4) }),
    fact({ entityId: 'dawn', attribute: 'when', value: pos(1) }),
    fact({ entityId: 'dawn', attribute: 'when', value: pos(2) }),
  ]);

  it('exports kinds, kept facts, unresolved and timeline', () => {
    const md = storyBibleMarkdown(items, b);
    expect(md).toContain('## Story Bible');
    expect(md.indexOf('### Character')).toBeLessThan(md.indexOf('### Event'));
    expect(md.indexOf('### Event')).toBeLessThan(md.indexOf('### Other'));
    expect(md).toContain('#### Mira');
    expect(md).toContain('- **Death:** *(unresolved, see Unresolved)*');
    expect(md.slice(0, md.indexOf('### Unresolved'))).not.toContain('Pilot');
    expect(md).toContain('- **Mira · Death:** Season 3 finale / Pilot');
    expect(md).toContain('- **eyes:** *(unresolved, see Unresolved)*');
    expect(md).not.toContain('multiple versions kept');
    expect(md).toContain('### Unresolved');
    expect(md).toContain('- **Dawn · when:** Season 1 / Season 2');
    expect(md).toContain('- **Mira · eyes:** green / hazel');
    expect(md).toContain('### Timeline\n\n- S3 · E4: Hal\n- Timing contested: Dawn');
  });
  it('marks acknowledged conflicts with their note, and lists versions, unplaced events and one-line text', () => {
    const f1 = fact({ entityId: 'mira', attribute: 'eyes', value: 'green' });
    const f2 = fact({ entityId: 'mira', attribute: 'eyes', value: 'hazel' });
    const w1 = fact({ entityId: 'hal', attribute: 'when', value: pos(3, 4) });
    const w2 = fact({ entityId: 'hal', attribute: 'when', value: pos(5, 1) });
    const dec = (entityId: string, attribute: string, ids: string[], note?: string): Decision =>
      ({ id: `d-${entityId}`, entityId, attribute, kind: 'kept_all', factIds: ids, setAsideIds: [], note, at: 'T0' });
    const md = storyBibleMarkdown([...items, ent('lull', 'Lull', 'event')], bibleOf([f1, f2, w1, w2], [
      dec('mira', 'eyes', [f1.id, f2.id], 'dye\njob'), dec('hal', 'when', [w1.id, w2.id]),
    ]));
    expect(md).toContain('- **eyes:** green\n- **eyes:** hazel\n  *(multiple versions kept: dye job)*');
    expect(md).toContain('- S3 · E4: Hal (version 1 of 2)\n- S5 · E1: Hal (version 2 of 2)');
    expect(md).toContain('- Unplaced: Lull');
    expect(md).not.toContain('### Unresolved');
  });
  it('collapses newlines in titles, attributes and values', () => {
    const md = storyBibleMarkdown([ent('m', 'Mira\n## Injected', 'character')],
      bibleOf([fact({ entityId: 'm', attribute: 'a\r\nb', value: 'x\n# y' })]));
    expect(md).toContain('#### Mira ## Injected');
    expect(md).toContain('- **a b:** x # y');
    expect(md).not.toMatch(/^# y/m);
  });
  it('is empty without entities and leaves the dossier unchanged', () => {
    expect(storyBibleMarkdown([], b)).toBe('');
    const plain = [{ id: 'd', parentId: null, type: 'document', title: 'D', order: 0, keywords: [] }] as TreeItem[];
    const d = new Date(0);
    expect(generateDossier('P', plain, () => '', d, b)).toBe(generateDossier('P', plain, () => '', d));
    expect(generateDossier('P', items, () => '', d, b)).toContain('## Story Bible');
  });
});

describe('sourceOrder', () => {
  const it2 = (id: string, type: string, order = 0): TreeItem => ({ id, parentId: null, type, title: id, order, keywords: [] });
  const items = [it2('A', 'document', 0), it2('B', 'chat', 1), it2('F', 'folder', 2), it2('C', 'chat', 3)];

  it('lists unlisted sources first (binder order), then listed ones oldest first', () => {
    expect(orderedSources({ ...emptyBible(), sourceOrder: ['C', 'B'] }, items).map(i => i.id)).toEqual(['A', 'C', 'B']);
    expect(orderedSources(emptyBible(), items).map(i => i.id)).toEqual(['A', 'B', 'C']);
  });

  it('knows which items are sources', () => {
    expect(SOURCE_TYPES).toEqual(['chat', 'ai-chat', 'document']);
    expect(isSourceItem({ type: 'ai-chat' })).toBe(true);
    expect(isSourceItem({ type: 'entity' })).toBe(false);
  });

  it('inserts new ids at a position among the existing sources', () => {
    const b = { ...emptyBible(), sourceOrder: ['A', 'B'] };
    const two = [it2('A', 'document'), it2('B', 'chat', 1)];
    expect(insertSources(b, two, ['N1', 'N2'], 1).sourceOrder).toEqual(['A', 'N1', 'N2', 'B']);
    expect(insertSources(b, two, ['N1'], 2).sourceOrder).toEqual(['A', 'B', 'N1']);
    expect(insertSources(b, two, ['N1'], 0).sourceOrder).toEqual(['N1', 'A', 'B']);
  });

  it('insertSources moves ids that are already listed', () => {
    const b = { ...emptyBible(), sourceOrder: ['A', 'B', 'N'] };
    expect(insertSources(b, [it2('A', 'document'), it2('B', 'chat', 1)], ['N'], 0).sourceOrder).toEqual(['N', 'A', 'B']);
  });

  it('appends new ids and returns the same bible when nothing changes', () => {
    const b = { ...emptyBible(), sourceOrder: ['A'] };
    expect(appendSources(b, ['A', 'B']).sourceOrder).toEqual(['A', 'B']);
    expect(appendSources(b, ['A'])).toBe(b);
    expect(appendSources(b, [])).toBe(b);
    expect(appendSources(emptyBible(), ['X']).sourceOrder).toEqual(['X']);
  });

  it('setSourceOrder stores the given order', () => {
    expect(setSourceOrder(emptyBible(), ['B', 'A']).sourceOrder).toEqual(['B', 'A']);
  });

  it('pruneOrphans drops sourceOrder ids that are no longer in the tree', () => {
    const b = { ...emptyBible(), sourceOrder: ['A', 'gone', 'B'] };
    expect(pruneOrphans(b, items).sourceOrder).toEqual(['A', 'B']);
    const clean = { ...emptyBible(), sourceOrder: ['A'] };
    expect(pruneOrphans(clean, items)).toBe(clean);
    expect(pruneOrphans(emptyBible(), items)).not.toHaveProperty('sourceOrder');
  });
});
