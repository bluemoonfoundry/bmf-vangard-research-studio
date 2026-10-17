import { describe, it, expect } from 'vitest';
import { projectReducer, isDirty, isDocDirty, isStructureDirty, buildSavePayload, type ProjectState } from '@/project/projectState';
import type { OpenedProject, TreeItem } from '@/project/types';

const item = (id: string, order = 0, parentId: string | null = null): TreeItem =>
  ({ id, parentId, type: 'document', title: id.toUpperCase(), order, keywords: [] });

function opened(items: TreeItem[] = []): OpenedProject {
  return {
    root: '/p/A.vrs',
    manifest: { schemaVersion: 1, id: 'p', name: 'A', createdAt: 'T', updatedAt: 'T', settings: {} },
    tree: { items },
    migratedFrom: null,
    recovery: null,
  };
}

const open = (items: TreeItem[] = []) => projectReducer(null, { type: 'opened', project: opened(items) }) as ProjectState;

describe('projectReducer', () => {
  it('opens clean', () => {
    const s = open([item('a')]);
    expect(s.root).toBe('/p/A.vrs');
    expect(isDirty(s)).toBe(false);
    expect(buildSavePayload(s)).toEqual({});
  });

  it('tracks a loaded document as clean until edited', () => {
    let s = projectReducer(open([item('a')]), { type: 'docLoaded', id: 'a', content: 'disk' })!;
    expect(isDirty(s)).toBe(false);
    s = projectReducer(s, { type: 'docEdited', id: 'a', content: 'edited' })!;
    expect(isDocDirty(s, 'a')).toBe(true);
    expect(isStructureDirty(s)).toBe(false);
    expect(buildSavePayload(s)).toEqual({ docs: { a: 'edited' } });
  });

  it('editing back to the saved text is clean again', () => {
    let s = projectReducer(open([item('a')]), { type: 'docLoaded', id: 'a', content: 'disk' })!;
    s = projectReducer(s, { type: 'docEdited', id: 'a', content: 'x' })!;
    s = projectReducer(s, { type: 'docEdited', id: 'a', content: 'disk' })!;
    expect(isDirty(s)).toBe(false);
  });

  it('does not let a late load overwrite edits', () => {
    let s = projectReducer(open([item('a')]), { type: 'docAdded', item: item('b', 1) })!;
    s = projectReducer(s, { type: 'docEdited', id: 'b', content: 'typed' })!;
    s = projectReducer(s, { type: 'docLoaded', id: 'b', content: '' })!;
    expect(s.docs.b.current).toBe('typed');
  });

  it('adds a document to the tree and writes it on save', () => {
    const s = projectReducer(open(), { type: 'docAdded', item: item('a') })!;
    expect(isDirty(s)).toBe(true);
    expect(buildSavePayload(s)).toEqual({ tree: { items: [item('a')] }, docs: { a: '' } });
  });

  it('renames items and the project', () => {
    let s = projectReducer(open([item('a')]), { type: 'itemRenamed', id: 'a', title: 'Chapter 1' })!;
    s = projectReducer(s, { type: 'projectRenamed', name: 'Saga' })!;
    expect(s.tree.items[0].title).toBe('Chapter 1');
    expect(buildSavePayload(s)).toMatchObject({ manifest: { name: 'Saga' }, tree: { items: [{ title: 'Chapter 1' }] } });
  });

  it('deletes an item with its descendants, removing their files on save', () => {
    let s = open([item('a'), item('b', 0, 'a'), item('c', 1)]);
    s = projectReducer(s, { type: 'docLoaded', id: 'b', content: 'x' })!;
    s = projectReducer(s, { type: 'itemDeleted', id: 'a' })!;
    expect(s.tree.items.map(i => i.id)).toEqual(['c']);
    expect(s.docs.b).toBeUndefined();
    expect(buildSavePayload(s).docs).toEqual({ a: null, b: null });
  });

  it('does not ask to delete a file for a document that was never saved', () => {
    let s = projectReducer(open(), { type: 'docAdded', item: item('a') })!;
    s = projectReducer(s, { type: 'itemDeleted', id: 'a' })!;
    expect(buildSavePayload(s).docs).toBeUndefined();
  });

  it('marks exactly what was saved as clean, keeping edits made during the save', () => {
    let s = projectReducer(open(), { type: 'docAdded', item: item('a') })!;
    s = projectReducer(s, { type: 'docEdited', id: 'a', content: 'v1' })!;
    const payload = buildSavePayload(s);
    s = projectReducer(s, { type: 'docEdited', id: 'a', content: 'v2' })!; // typed while saving
    s = projectReducer(s, { type: 'saved', payload, manifest: { ...s.manifest, updatedAt: 'T2' } })!;

    expect(s.manifest.updatedAt).toBe('T2');
    expect(isStructureDirty(s)).toBe(false);
    expect(buildSavePayload(s)).toEqual({ docs: { a: 'v2' } });
  });

  it('forgets saved deletions', () => {
    let s = projectReducer(open([item('a')]), { type: 'itemDeleted', id: 'a' })!;
    s = projectReducer(s, { type: 'saved', payload: buildSavePayload(s), manifest: s.manifest })!;
    expect(isDirty(s)).toBe(false);
  });

  it('restores a recovery snapshot on top of what is on disk', () => {
    let s = open([item('a'), item('gone')]);
    s = projectReducer(s, {
      type: 'recoveryRestored',
      snapshot: { savedAt: 'T', manifest: { name: 'Recovered' }, tree: { items: [item('a'), item('new', 1)] }, docs: { a: 'unsaved', new: 'fresh', gone: null } },
      diskDocs: { a: 'on disk' },
    })!;
    expect(s.manifest.name).toBe('Recovered');
    expect(s.docs.a).toEqual({ saved: 'on disk', current: 'unsaved' });
    expect(s.docs.new).toEqual({ saved: null, current: 'fresh' });
    expect(buildSavePayload(s)).toMatchObject({ docs: { a: 'unsaved', new: 'fresh', gone: null } });
  });

  it('reloads a document from disk', () => {
    let s = projectReducer(open([item('a')]), { type: 'docLoaded', id: 'a', content: 'old' })!;
    s = projectReducer(s, { type: 'docEdited', id: 'a', content: 'mine' })!;
    s = projectReducer(s, { type: 'docReloaded', id: 'a', content: 'theirs' })!;
    expect(s.docs.a).toEqual({ saved: 'theirs', current: 'theirs' });
  });

  it('keeps local edits but rebases them on the new disk content', () => {
    let s = projectReducer(open([item('a')]), { type: 'docLoaded', id: 'a', content: 'old' })!;
    s = projectReducer(s, { type: 'docEdited', id: 'a', content: 'mine' })!;
    s = projectReducer(s, { type: 'docDiskChanged', id: 'a', content: 'mine' })!;
    expect(isDirty(s)).toBe(false);
  });

  it('reloads the structure from disk, dropping documents no longer in the tree', () => {
    let s = projectReducer(open([item('a'), item('b')]), { type: 'docLoaded', id: 'b', content: 'x' })!;
    s = projectReducer(s, { type: 'structureReloaded', manifest: { ...s.manifest, name: 'Renamed outside' }, tree: { items: [item('a')] } })!;
    expect(s.manifest.name).toBe('Renamed outside');
    expect(s.docs.b).toBeUndefined();
    expect(isDirty(s)).toBe(false);
  });

  it('closes', () => {
    expect(projectReducer(open(), { type: 'closed' })).toBeNull();
  });
});
