import { describe, it, expect } from 'vitest';
import type { TreeItem } from '@/project/types';
import { ancestorsOf, childrenOf, descendantIds, duplicateSubtree, moveItem, nextOrder } from '@/workspace/treeOps';

const item = (id: string, parentId: string | null = null, order = 0, type = 'document'): TreeItem =>
  ({ id, parentId, type, title: id.toUpperCase(), order, keywords: [] });

// root: f(folder){ a, b }, c, g(folder){}
const tree = () => [
  item('f', null, 0, 'folder'),
  item('a', 'f', 0),
  item('b', 'f', 1),
  item('c', null, 1),
  item('g', null, 2, 'folder'),
];

const layout = (items: TreeItem[], parentId: string | null = null): string[] =>
  childrenOf(items, parentId).map(i => i.id);

describe('tree queries', () => {
  it('lists children in order and finds descendants', () => {
    expect(layout(tree())).toEqual(['f', 'c', 'g']);
    expect([...descendantIds(tree(), 'f')].sort()).toEqual(['a', 'b', 'f']);
  });

  it('walks ancestors outermost first and survives cycles', () => {
    const items = [item('x', 'y'), item('y', 'x'), item('z', 'x')];
    expect(ancestorsOf(tree(), 'b').map(i => i.id)).toEqual(['f']);
    expect(ancestorsOf(items, 'z').map(i => i.id)).toEqual(['y', 'x']);
  });

  it('computes the next order within a parent', () => {
    expect(nextOrder(tree(), 'f')).toBe(2);
    expect(nextOrder(tree(), 'g')).toBe(0);
  });
});

describe('moveItem', () => {
  it('reorders among siblings', () => {
    const next = moveItem(tree(), 'b', 'a', 'before')!;
    expect(layout(next, 'f')).toEqual(['b', 'a']);
  });

  it('moves into a folder at the end and out to the root', () => {
    let next = moveItem(tree(), 'c', 'f', 'inside')!;
    expect(layout(next, 'f')).toEqual(['a', 'b', 'c']);
    next = moveItem(next, 'a', null, 'inside')!;
    expect(layout(next)).toEqual(['f', 'g', 'a']);
  });

  it('moves next to an item in another folder', () => {
    const next = moveItem(tree(), 'c', 'a', 'after')!;
    expect(layout(next, 'f')).toEqual(['a', 'c', 'b']);
    expect(layout(next)).toEqual(['f', 'g']);
  });

  it('refuses moves into its own subtree or into a non-folder', () => {
    expect(moveItem(tree(), 'f', 'a', 'inside')).toBeNull();
    expect(moveItem(tree(), 'f', 'b', 'after')).toBeNull();
    expect(moveItem(tree(), 'c', 'a', 'inside')).toBeNull();
  });

  it('returns null for a move that changes nothing, and keeps untouched items', () => {
    const items = tree();
    expect(moveItem(items, 'a', 'b', 'before')).toBeNull();
    const next = moveItem(items, 'g', 'f', 'before')!;
    expect(next.find(i => i.id === 'a')).toBe(items.find(i => i.id === 'a'));
  });
});

describe('duplicateSubtree', () => {
  let n = 0;
  const newId = () => `n${++n}`;

  it('copies a folder with fresh ids, placed right after the original', () => {
    n = 0;
    const items = tree().map(i => (i.id === 'b' ? { ...i, references: [{ id: 'r', targetId: 'a' }, { id: 'r2', targetId: 'c' }] } : i));
    const { added, idMap } = duplicateSubtree(items, 'f', newId, 'NOW');
    expect(added).toHaveLength(3);
    const copy = added.find(i => i.id === idMap.get('f'))!;
    expect(copy).toMatchObject({ title: 'F (copy)', parentId: null, order: 0.5, createdAt: 'NOW' });
    expect(layout([...items, ...added])).toEqual(['f', copy.id, 'c', 'g']);
    expect(layout([...items, ...added], copy.id)).toEqual([idMap.get('a'), idMap.get('b')]);

    const bCopy = added.find(i => i.id === idMap.get('b'))!;
    expect(bCopy.references!.map(r => r.targetId)).toEqual([idMap.get('a'), 'c']);
    expect(new Set([...items, ...added].map(i => i.id)).size).toBe(8);
  });

  it('places a copy of the last sibling at the end', () => {
    const { added } = duplicateSubtree(tree(), 'g', newId, 'NOW');
    expect(added[0].order).toBe(3);
  });
});
