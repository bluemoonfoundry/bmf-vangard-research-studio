import { describe, expect, it } from 'vitest';
import type { TreeItem } from '@/project/types';
import { nameParts, sharedNames, sharedNamesText } from '@/bible/names';

const ent = (id: string, title: string, entityKind = 'character'): TreeItem =>
  ({ id, parentId: null, type: 'entity', entityKind, title, order: 0, keywords: [] });
const items = [
  ent('a', 'Anna Smith'), ent('b', 'Ben Smith'), ent('c', 'Anna de Vries'), ent('d', 'Mr. Clay'),
  ent('e', 'Smith Harbour', 'location'), ent('f', 'New character'), ent('g', 'New character'),
  { id: 'doc', parentId: null, type: 'document', title: 'Ben Smith notes', order: 0, keywords: [] } as TreeItem,
];

describe('nameParts', () => {
  it('splits a title into name words, ignoring titles, particles and short words', () => {
    expect(nameParts('Mr. John  O\'Neill-Smith')).toEqual(['john', 'o\'neill-smith']);
    expect(nameParts('Anna de Vries')).toEqual(['anna', 'vries']);
    expect(nameParts('The Duke of Ely')).toEqual(['duke', 'ely']);
    expect(nameParts('Élodie Brûlé')).toEqual(['élodie', 'brûlé']);
    expect(nameParts('New character')).toEqual([]);
    expect(nameParts('')).toEqual([]);
  });
});

describe('sharedNames', () => {
  it('finds other characters sharing a name word, keeping the given spelling', () => {
    expect(sharedNames('Anna Smith', items, 'a')).toEqual([
      { part: 'Anna', others: [items[2]] },
      { part: 'Smith', others: [items[1]] },
    ]);
  });

  it('ignores other kinds, non-entities, placeholder titles and the entity itself', () => {
    expect(sharedNames('Ben Smith', items, 'b')).toEqual([{ part: 'Smith', others: [items[0]] }]);
    expect(sharedNames('New character', items, 'f')).toEqual([]);
    expect(sharedNames('Clay', items)).toEqual([{ part: 'Clay', others: [items[3]] }]);
  });

  it('matches ignoring case', () => {
    expect(sharedNames('ben SMITH', items)).toEqual([{ part: 'ben', others: [items[1]] }, { part: 'SMITH', others: [items[0], items[1]] }]);
  });

  it('reads as one line per shared word', () => {
    expect(sharedNamesText(sharedNames('Anna Smith', items, 'a'))).toEqual(['Shares "Anna" with Anna de Vries', 'Shares "Smith" with Ben Smith']);
  });
});
