import { describe, expect, it } from 'vitest';
import type { Bible, Fact, TreeItem } from '@/project/types';
import { findContradictions, openContradictions } from '@/bible/contradictions';
import {
  CARD_FACT_LIMIT, cameFrom, canonLines, cardLines, cardStats, linkedItems, portraitOf, togglePin, wallTabs,
} from '@/bible/cards';

let n = 0;
const fact = (over: Partial<Fact> = {}): Fact => ({
  id: `f${++n}`, entityId: 'e1', attribute: 'Role', value: 'x', status: 'kept', origin: 'manual',
  createdAt: 'T0', updatedAt: 'T0', ...over,
});
const src = (itemId: string) => ({ itemId, quote: 'q', start: 0, end: 1 });
const bibleOf = (facts: Fact[]): Bible => ({ facts, dependencies: [], decisions: [] });
const item = (over: Partial<TreeItem> & { id: string }): TreeItem => ({
  parentId: null, type: 'document', title: over.id, order: 0, keywords: [], ...over,
});
const mara = item({ id: 'e1', type: 'entity', entityKind: 'character', title: 'Mara' });

describe('age lines', () => {
  it('labels a dated age line with the start age', () => {
    const bible = bibleOf([
      fact({ attribute: 'Age', value: { age: 6, year: 0 } }),
      fact({ attribute: 'age', value: { age: 18, year: 12 } }),
    ]);
    const [line] = canonLines(bible, mara);
    expect(line.key).toBe('age');
    expect(line.versions.map(v => v.label)).toEqual(['6 at the start']);
  });

  it('leaves text values unlabelled', () => {
    expect(canonLines(bibleOf([fact({ attribute: 'Age', value: '6' })]), mara)[0].versions[0].label).toBeUndefined();
  });
});

describe('wallTabs', () => {
  it('has a tab per known kind with its entities sorted by title, and Other only when needed', () => {
    const items = [
      item({ id: 'b', type: 'entity', entityKind: 'character', title: 'Bryn' }),
      item({ id: 'a', type: 'entity', entityKind: 'character', title: 'alder' }),
      item({ id: 'l', type: 'entity', entityKind: 'location', title: 'Keep' }),
      item({ id: 'd', title: 'Notes' }),
    ];
    const tabs = wallTabs(items);
    expect(tabs.map(t => t.id)).toEqual(['character', 'location', 'faction', 'item', 'lore', 'event', 'plotline']);
    expect(tabs[0].entities.map(e => e.id)).toEqual(['a', 'b']);
    expect(tabs[0].name).toBe('Characters');
    expect(tabs[2].entities).toEqual([]);
  });

  it('collects entities of an unknown or missing kind under Other', () => {
    const tabs = wallTabs([
      item({ id: 'x', type: 'entity', entityKind: 'spell', title: 'Ward' }),
      item({ id: 'y', type: 'entity', title: 'Thing' }),
    ]);
    const other = tabs.at(-1)!;
    expect(other.id).toBe('other');
    expect(other.entities.map(e => e.id)).toEqual(['y', 'x']);
  });
});

describe('canonLines', () => {
  it('groups kept facts by attribute and ignores proposed and set-aside ones', () => {
    const b = bibleOf([
      fact({ attribute: 'Eyes', value: 'green' }),
      fact({ attribute: 'eyes ', value: 'Green', source: src('c1') }),
      fact({ attribute: 'Eyes', value: 'green', source: src('c2') }),
      fact({ attribute: 'Hair', value: 'red', status: 'proposed' }),
      fact({ attribute: 'Scar', value: 'left cheek', status: 'set_aside' }),
    ]);
    const lines = canonLines(b, mara);
    expect(lines.map(l => l.attribute)).toEqual(['Eyes']);
    expect(lines[0].versions).toHaveLength(1);
    expect(lines[0].versions[0].sourceCount).toBe(2);
  });

  it('keeps both versions of an attribute the writer kept all of', () => {
    const b = bibleOf([fact({ attribute: 'Age', value: '24' }), fact({ attribute: 'Age', value: '25' })]);
    expect(canonLines(b, mara)[0].versions.map(v => v.value)).toEqual(['24', '25']);
  });

  it('orders pinned attributes first, then the kind default order, then the rest as added', () => {
    const b = bibleOf([
      fact({ attribute: 'Hobby', value: 'chess' }),
      fact({ attribute: 'Eyes', value: 'green' }),
      fact({ attribute: 'Age', value: '24' }),
      fact({ attribute: 'Role', value: 'heir' }),
    ]);
    expect(canonLines(b, mara).map(l => l.attribute)).toEqual(['Role', 'Age', 'Hobby', 'Eyes']);
    const pinned = { ...mara, cardFacts: ['eyes'] };
    const lines = canonLines(b, pinned);
    expect(lines.map(l => l.attribute)).toEqual(['Eyes', 'Role', 'Age', 'Hobby']);
    expect(lines.map(l => l.pinned)).toEqual([true, false, false, false]);
  });
});

describe('cardLines', () => {
  const many = bibleOf(['A', 'B', 'C', 'D', 'E', 'F', 'G'].map(a => fact({ attribute: a, value: a.toLowerCase() })));

  it('shows the first few canon lines when nothing is pinned', () => {
    expect(cardLines(many, mara).map(l => l.attribute)).toEqual(['A', 'B', 'C', 'D', 'E']);
    expect(CARD_FACT_LIMIT).toBe(5);
  });

  it('shows only pinned lines when the writer pinned some, skipping pins with no kept fact', () => {
    const pinned = { ...mara, cardFacts: ['g', 'missing', 'b'] };
    expect(cardLines(many, pinned).map(l => l.attribute)).toEqual(['G', 'B']);
  });

  it('falls back to the default when every pin is stale', () => {
    expect(cardLines(many, { ...mara, cardFacts: ['missing'] })).toHaveLength(5);
  });
});

describe('togglePin', () => {
  it('adds and removes attribute keys', () => {
    expect(togglePin(mara, ' Eyes ')).toEqual(['eyes']);
    expect(togglePin({ ...mara, cardFacts: ['eyes', 'age'] }, 'EYES')).toEqual(['age']);
  });
});

describe('cardStats and cameFrom', () => {
  const b = bibleOf([
    fact({ attribute: 'Eyes', value: 'green', source: src('c1') }),
    fact({ attribute: 'Eyes', value: 'blue', status: 'proposed', source: src('c2') }),
    fact({ attribute: 'Age', value: '24', status: 'proposed', source: src('c1') }),
    fact({ attribute: 'Hair', value: 'red', status: 'set_aside', source: src('c3') }),
    fact({ entityId: 'other', attribute: 'Eyes', value: 'grey', source: src('c4') }),
  ]);

  it('counts kept, proposed, open conflicts and the distinct sources of live facts', () => {
    const open = openContradictions(findContradictions(b, new Set(['e1', 'other'])));
    expect(cardStats(b, 'e1', open)).toEqual({ kept: 1, proposed: 2, openConflicts: 1, sources: 2 });
  });

  it('lists the source items of every fact about the entity, first seen first', () => {
    expect(cameFrom(b, 'e1')).toEqual([
      { itemId: 'c1', facts: 2 }, { itemId: 'c2', facts: 1 }, { itemId: 'c3', facts: 1 },
    ]);
  });
});

describe('counts from extraction evidence', () => {
  const ev = (itemId: string) => ({ source: src(itemId), strength: 'said' as const });
  const b = bibleOf([
    fact({ attribute: 'Eyes', value: 'green', source: src('c1'), evidence: [ev('c1'), ev('c2'), ev('c1')] }),
    fact({ attribute: 'Age', value: '24', status: 'proposed', source: src('c3') }),
  ]);

  it('counts every source item in a fact\'s evidence', () => {
    expect(cardStats(b, 'e1', []).sources).toBe(3);
    expect(canonLines(b, mara)[0].versions[0].sourceCount).toBe(2);
  });

  it('credits each evidence item once per fact in Came from', () => {
    expect(cameFrom(b, 'e1')).toEqual([{ itemId: 'c1', facts: 1 }, { itemId: 'c2', facts: 1 }, { itemId: 'c3', facts: 1 }]);
  });
});

describe('linkedItems and portraitOf', () => {
  const pic = item({ id: 'p1', type: 'image', asset: 'p1.png' });
  const pic2 = item({ id: 'p2', type: 'image', asset: 'p2.png' });
  const bare = item({ id: 'p0', type: 'image' });
  const song = item({ id: 'a1', type: 'audio', asset: 'a1.mp3' });
  const ally = item({ id: 'e2', type: 'entity', entityKind: 'character', title: 'Bryn' });
  const doc = item({ id: 'd1' });
  const refs = (...ids: string[]) => ids.map(targetId => ({ id: `r-${targetId}`, targetId }));
  const byId = new Map([pic, pic2, bare, song, ally, doc].map(i => [i.id, i]));

  it('sorts references into images, audio, related entities and other links, dropping dangling ones', () => {
    const e = { ...mara, references: refs('d1', 'p1', 'gone', 'a1', 'e2', 'p2') };
    const linked = linkedItems(e, byId);
    expect(linked.images.map(i => i.id)).toEqual(['p1', 'p2']);
    expect(linked.audio.map(i => i.id)).toEqual(['a1']);
    expect(linked.related.map(i => i.id)).toEqual(['e2']);
    expect(linked.other.map(i => i.id)).toEqual(['d1']);
  });

  it('uses the chosen portrait, else the first linked image with a file', () => {
    expect(portraitOf({ ...mara, references: refs('p0', 'p1', 'p2') }, byId)?.id).toBe('p1');
    expect(portraitOf({ ...mara, references: refs('p1', 'p2'), portraitId: 'p2' }, byId)?.id).toBe('p2');
    expect(portraitOf({ ...mara, references: refs('p1'), portraitId: 'gone' }, byId)?.id).toBe('p1');
    expect(portraitOf(mara, byId)).toBeUndefined();
  });
});
