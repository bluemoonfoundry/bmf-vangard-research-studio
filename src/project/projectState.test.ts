import { describe, it, expect } from 'vitest';
import { projectReducer, isChatDirty, isDirty, isDocDirty, isStructureDirty, buildSavePayload, type ProjectState } from '@/project/projectState';
import { applyStreamEvent, beginSend, newTranscript, updateSettings } from '@/chat/transcript';
import type { ChatTranscript } from '@/chat/types';
import { emptyBible } from '@/bible/normalize';
import type { OpenedProject, TreeItem } from '@/project/types';

const item = (id: string, order = 0, parentId: string | null = null): TreeItem =>
  ({ id, parentId, type: 'document', title: id.toUpperCase(), order, keywords: [] });

function opened(items: TreeItem[] = []): OpenedProject {
  return {
    root: '/p/A.vrs',
    manifest: { schemaVersion: 1, id: 'p', name: 'A', createdAt: 'T', updatedAt: 'T', settings: {} },
    tree: { items },
    bible: emptyBible(),
    migratedFrom: null,
    recovery: null,
  };
}

const open = (items: TreeItem[] = []) => projectReducer(null, { type: 'opened', project: opened(items) }) as ProjectState;

describe('orphan pruning on save', () => {
  const ent = (id: string): TreeItem => ({ id, parentId: null, type: 'entity', entityKind: 'character', title: id, order: 0, keywords: [] }) as TreeItem;
  const f = (id: string, entityId: string) => ({ id, entityId, attribute: 'a', value: 'v', status: 'kept' as const, origin: 'manual' as const, createdAt: 'T', updatedAt: 'T' });

  it('includes a cleaned bible even when the bible is otherwise saved', () => {
    const o = opened([ent('e1')]);
    o.bible = { facts: [f('ok', 'e1'), f('gone', 'zz')], dependencies: [], decisions: [] };
    const s = projectReducer(null, { type: 'opened', project: o })!;
    expect(isDirty(s)).toBe(false);
    expect(buildSavePayload(s).bible?.facts.map(x => x.id)).toEqual(['ok']);
  });

  it('prunes orphans from a dirty bible and omits an already-clean one', () => {
    let s = projectReducer(null, { type: 'opened', project: opened([ent('e1')]) })!;
    s = projectReducer(s, { type: 'bibleUpdated', update: b => ({ ...b, facts: [f('ok', 'e1'), f('gone', 'zz')] }) })!;
    expect(buildSavePayload(s).bible?.facts.map(x => x.id)).toEqual(['ok']);
    const clean = projectReducer(null, { type: 'opened', project: opened([ent('e1')]) })!;
    expect(buildSavePayload(clean).bible).toBeUndefined();
  });

  it('a save that pruned orphans leaves the project clean', () => {
    const o = opened([ent('e1')]);
    o.bible = { facts: [f('ok', 'e1'), f('gone', 'zz')], dependencies: [], decisions: [] };
    let s = projectReducer(null, { type: 'opened', project: o })!;
    const payload = buildSavePayload(s);
    s = projectReducer(s, { type: 'saved', payload, manifest: s.manifest })!;
    expect(s.bible.facts.map(x => x.id)).toEqual(['ok']);
    expect(buildSavePayload(s)).toEqual({});
  });

  it('structureKeptMine marks the whole structure unsaved', () => {
    const s = projectReducer(open([item('a')]), { type: 'structureKeptMine' })!;
    expect(buildSavePayload(s)).toMatchObject({ manifest: { name: 'A' }, tree: { items: [item('a')] }, bible: emptyBible() });
  });
});

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
    expect(buildSavePayload(s)).toEqual({ tree: { items: [item('a')] }, docs: { a: '' }, bible: { ...emptyBible(), sourceOrder: ['a'] } });
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
      diskChats: {},
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
    s = projectReducer(s, { type: 'structureReloaded', manifest: { ...s.manifest, name: 'Renamed outside' }, tree: { items: [item('a')] }, bible: emptyBible() })!;
    expect(s.manifest.name).toBe('Renamed outside');
    expect(s.docs.b).toBeUndefined();
    expect(isDirty(s)).toBe(false);
  });

  it('loads many documents at once, ignoring ones already loaded or not in the tree', () => {
    let s = projectReducer(open([item('a'), item('b', 1)]), { type: 'docEdited', id: 'a', content: 'x' })!;
    s = projectReducer(s, { type: 'docLoaded', id: 'a', content: 'disk a' })!;
    s = projectReducer(s, { type: 'docEdited', id: 'a', content: 'edited a' })!;
    s = projectReducer(s, { type: 'docsLoaded', docs: { a: 'stale', b: 'disk b', zombie: 'z' } })!;
    expect(s.docs).toEqual({ a: { saved: 'disk a', current: 'edited a' }, b: { saved: 'disk b', current: 'disk b' } });
  });

  it('adds several items with bodies, saving them as new files', () => {
    const s = projectReducer(open(), { type: 'itemsAdded', items: [item('f'), item('x', 0, 'f')], docs: { x: 'body' } })!;
    expect(buildSavePayload(s)).toEqual({
      tree: { items: [item('f'), item('x', 0, 'f')] }, docs: { f: '', x: 'body' }, bible: { ...emptyBible(), sourceOrder: ['f', 'x'] },
    });
  });

  it('adds new source items (chats, AI chats, documents) to the source order as newest', () => {
    const chat: TreeItem = { ...item('c'), type: 'chat' };
    const s = projectReducer(open(), { type: 'itemsAdded', items: [{ ...item('f'), type: 'folder' }, chat], docs: {} })!;
    expect(s.bible.sourceOrder).toEqual(['c']);
  });

  it('patches an item without letting the patch change its id', () => {
    const s = projectReducer(open([item('a')]), { type: 'itemUpdated', id: 'a', patch: { synopsis: 'Card', id: 'evil' } })!;
    expect(s.tree.items).toEqual([{ ...item('a'), synopsis: 'Card' }]);
  });

  it('moves items, and ignores impossible moves', () => {
    const f = { ...item('f'), type: 'folder' };
    let s = open([f, item('a', 1)]);
    s = projectReducer(s, { type: 'itemMoved', id: 'a', targetId: 'f', position: 'inside' })!;
    expect(s.tree.items.find(i => i.id === 'a')?.parentId).toBe('f');
    expect(projectReducer(s, { type: 'itemMoved', id: 'f', targetId: 'a', position: 'inside' })).toBe(s);
  });

  it('deleting items drops links to them and queues their assets', () => {
    const linked = { ...item('b', 1), references: [{ id: 'r1', targetId: 'a' }, { id: 'r2', targetId: 'c' }] };
    let s = open([{ ...item('a'), asset: 'a.png' }, linked, item('c', 2)]);
    s = projectReducer(s, { type: 'itemDeleted', id: 'a' })!;
    expect(s.tree.items.find(i => i.id === 'b')?.references).toEqual([{ id: 'r2', targetId: 'c' }]);
    expect(buildSavePayload(s).deletedAssets).toEqual(['a.png']);
  });

  it('carries discarded assets into the next save without making the project dirty', () => {
    let s = projectReducer(open(), { type: 'assetDiscarded', asset: 'x.png' })!;
    expect(isDirty(s)).toBe(false);
    s = projectReducer(s, { type: 'projectRenamed', name: 'B' })!;
    const payload = buildSavePayload(s);
    expect(payload.deletedAssets).toEqual(['x.png']);
    s = projectReducer(s, { type: 'saved', payload, manifest: s.manifest })!;
    expect(buildSavePayload(s)).toEqual({});
  });

  it('closes', () => {
    expect(projectReducer(open(), { type: 'closed' })).toBeNull();
  });
});

describe('projectReducer: story bible', () => {
  const fact = (id: string, entityId: string, itemId?: string) => ({
    id, entityId, attribute: 'eyes', value: 'green', status: 'kept' as const, origin: 'user',
    createdAt: 'T', updatedAt: 'T', ...(itemId ? { source: { itemId, quote: 'q', start: 0, end: 1 } } : {}),
  });
  const entity = (id: string): TreeItem => ({ ...item(id), type: 'entity' });
  const chat = (id: string): TreeItem => ({ ...item(id), type: 'chat' });

  it('opens with bible and savedBible set and clean', () => {
    const s = open();
    expect(s.bible).toBe(s.savedBible);
    expect(isDirty(s)).toBe(false);
  });

  it('bibleUpdated marks dirty, is in the save payload, and saved cleans it', () => {
    let s = projectReducer(open([entity('e')]), { type: 'bibleUpdated', update: b => ({ ...b, facts: [fact('f', 'e')] }) })!;
    expect(isDirty(s)).toBe(true);
    const payload = buildSavePayload(s);
    expect(payload.bible?.facts).toHaveLength(1);
    s = projectReducer(s, { type: 'saved', payload, manifest: s.manifest })!;
    expect(isDirty(s)).toBe(false);
    expect(buildSavePayload(s)).toEqual({});
  });

  it('bibleUpdated returning the same bible leaves state unchanged', () => {
    const s = open();
    expect(projectReducer(s, { type: 'bibleUpdated', update: b => b })).toBe(s);
  });

  it('deleting an entity removes its facts; deleting a chat keeps facts citing it', () => {
    let s = projectReducer(open([entity('e'), chat('c')]), {
      type: 'bibleUpdated', update: b => ({ ...b, facts: [fact('f1', 'e'), fact('f2', 'e2', 'c')] }),
    })!;
    s = projectReducer(s, { type: 'itemDeleted', id: 'c' })!;
    expect(s.bible.facts.map(f => f.id)).toEqual(['f1', 'f2']);
    s = projectReducer(s, { type: 'itemDeleted', id: 'e' })!;
    expect(s.bible.facts.map(f => f.id)).toEqual(['f2']);
  });

  it('structureReloaded replaces the bible', () => {
    const s = open();
    const bible = { ...emptyBible(), facts: [fact('f', 'e')] };
    const r = projectReducer(s, { type: 'structureReloaded', manifest: s.manifest, tree: s.tree, bible })!;
    expect(r.bible).toBe(bible);
    expect(r.savedBible).toBe(bible);
  });

  it('recoveryRestored takes the snapshot bible as a dirty edit', () => {
    const s = open();
    const bible = { ...emptyBible(), facts: [fact('f', 'e')] };
    const r = projectReducer(s, { type: 'recoveryRestored', snapshot: { savedAt: 'T', bible }, diskDocs: {}, diskChats: {} })!;
    expect(r.bible).toBe(bible);
    expect(isDirty(r)).toBe(true);
  });
});

describe('projectReducer: AI chats', () => {
  const CAPS = { webSearch: false, readUrls: false, temperature: true };
  const DEFAULTS = { provider: 'anthropic' as const, model: 'm1' };
  const aiChat = (id: string, order = 0, parentId: string | null = null): TreeItem => ({ ...item(id, order, parentId), type: 'ai-chat' });
  const fresh = () => newTranscript(DEFAULTS);
  const saveAll = (s: ProjectState) => projectReducer(s, { type: 'saved', payload: buildSavePayload(s), manifest: s.manifest })!;
  const loaded = (items: TreeItem[], chats: Record<string, ChatTranscript | null>) =>
    projectReducer(open(items), {
      type: 'chatsLoaded',
      defaults: DEFAULTS,
      chats: Object.fromEntries(Object.entries(chats).map(([id, transcript]) => [id, { transcript, problem: null }])),
    })!;

  it('a new chat is dirty until saved', () => {
    const t = fresh();
    let s = projectReducer(open(), { type: 'itemsAdded', items: [aiChat('c')], docs: {}, chats: { c: t } })!;
    expect(s.chats.c).toEqual({ saved: null, current: t });
    expect(isChatDirty(s, 'c')).toBe(true);
    expect(buildSavePayload(s).chats).toEqual({ c: t });
    s = saveAll(s);
    expect(isChatDirty(s, 'c')).toBe(false);
    expect(isDirty(s)).toBe(false);
  });

  it('save mid-stream persists cancelled then re-dirties', () => {
    let s = loaded([aiChat('c')], { c: fresh() });
    s = projectReducer(s, {
      type: 'chatUpdated', id: 'c',
      update: t => applyStreamEvent(beginSend(t, { text: 'q', userId: 'u', assistantId: 'a', at: 'T', caps: CAPS }), 'a', { type: 'text', delta: 'part' }),
    })!;
    const payload = buildSavePayload(s);
    expect(payload.chats?.c?.messages.at(-1)).toMatchObject({ text: 'part', status: 'cancelled' });
    expect(s.chats.c.current.messages.at(-1)?.status).toBe('streaming');
    s = projectReducer(s, { type: 'saved', payload, manifest: s.manifest })!;
    expect(s.chats.c.saved).toBe(payload.chats?.c);
    expect(isChatDirty(s, 'c')).toBe(true); // still streaming: the stored copy says cancelled
    s = projectReducer(s, { type: 'chatUpdated', id: 'c', update: t => applyStreamEvent(t, 'a', { type: 'done', model: 'm1' }) })!;
    expect(isChatDirty(s, 'c')).toBe(true);
    expect(buildSavePayload(s).chats?.c?.messages.at(-1)).toMatchObject({ text: 'part', status: 'complete' });
  });

  it('an idle save leaves the chat clean', () => {
    let s = loaded([aiChat('c')], { c: fresh() });
    s = projectReducer(s, { type: 'chatUpdated', id: 'c', update: t => updateSettings(t, { webSearch: true }) })!;
    const payload = buildSavePayload(s);
    expect(payload.chats?.c).toBe(s.chats.c.current);
    s = projectReducer(s, { type: 'saved', payload, manifest: s.manifest })!;
    expect(isDirty(s)).toBe(false);
    expect(buildSavePayload(s)).toEqual({});
  });

  it('an update that returns the same transcript leaves state unchanged', () => {
    const s = loaded([aiChat('c')], { c: fresh() });
    expect(projectReducer(s, { type: 'chatUpdated', id: 'c', update: t => t })).toBe(s);
    expect(projectReducer(s, { type: 'chatUpdated', id: 'nope', update: () => fresh() })).toBe(s);
  });

  it('deleting an ai-chat item queues its file for deletion', () => {
    const f = { ...item('f'), type: 'folder' };
    let s = loaded([f, aiChat('c', 0, 'f'), aiChat('unloaded', 1, 'f')], { c: fresh() });
    s = projectReducer(s, { type: 'itemsAdded', items: [aiChat('new', 2, 'f')], docs: {}, chats: { new: fresh() } })!;
    s = projectReducer(s, { type: 'itemDeleted', id: 'f' })!;
    expect(s.chats).toEqual({});
    expect([...s.deletedChats].sort()).toEqual(['c', 'unloaded']);
    expect(buildSavePayload(s).chats).toEqual({ c: null, unloaded: null });
    s = saveAll(s);
    expect(s.deletedChats).toEqual([]);
    expect(isDirty(s)).toBe(false);
  });

  it('a missing file loads clean', () => {
    const s = projectReducer(open([aiChat('c'), aiChat('bad', 1)]), {
      type: 'chatsLoaded', defaults: DEFAULTS,
      chats: { c: { transcript: null, problem: null }, bad: { transcript: null, problem: 'chats/bad.json is not valid JSON.' } },
    })!;
    expect(s.chats.c.current).toEqual(fresh());
    expect(s.chats.c.problem).toBeUndefined();
    expect(s.chats.bad.problem).toBe('chats/bad.json is not valid JSON.');
    expect(isDirty(s)).toBe(false);
    expect(buildSavePayload(s)).toEqual({}); // a damaged file is left alone until the chat changes
  });

  it('chatsLoaded ignores chats already loaded or not in the tree', () => {
    let s = loaded([aiChat('c')], { c: fresh() });
    s = projectReducer(s, { type: 'chatUpdated', id: 'c', update: t => updateSettings(t, { readUrls: true }) })!;
    const mine = s.chats.c;
    s = projectReducer(s, {
      type: 'chatsLoaded', defaults: DEFAULTS,
      chats: { c: { transcript: fresh(), problem: null }, zombie: { transcript: fresh(), problem: null } },
    })!;
    expect(s.chats.c).toBe(mine);
    expect(s.chats.zombie).toBeUndefined();
  });

  it('recovery restores chats', () => {
    const disk = fresh();
    const unsaved = updateSettings(fresh(), { webSearch: true });
    const added = updateSettings(fresh(), { readUrls: true });
    let s = loaded([aiChat('c'), aiChat('gone', 1)], { c: disk, gone: fresh() });
    s = projectReducer(s, {
      type: 'recoveryRestored',
      snapshot: { savedAt: 'T', tree: { items: [aiChat('c'), aiChat('new', 1)] }, chats: { c: unsaved, new: added, gone: null } },
      diskDocs: {},
      diskChats: { c: disk },
    })!;
    expect(s.chats.c).toEqual({ saved: disk, current: unsaved });
    expect(s.chats.new.saved).toBeNull();
    expect(s.chats.new.current.settings.readUrls).toBe(true);
    expect(s.chats.gone).toBeUndefined();
    expect(buildSavePayload(s).chats).toEqual({ c: unsaved, new: added, gone: null });
  });

  it('reloads a chat from disk, or rebases unsaved changes on it', () => {
    let s = loaded([aiChat('c')], { c: fresh() });
    s = projectReducer(s, { type: 'chatUpdated', id: 'c', update: t => updateSettings(t, { webSearch: true }) })!;
    const theirs = updateSettings(fresh(), { readUrls: true });
    const kept = projectReducer(s, { type: 'chatDiskChanged', id: 'c', transcript: theirs })!;
    expect(kept.chats.c.saved).toBe(theirs);
    expect(isChatDirty(kept, 'c')).toBe(true);
    s = projectReducer(s, { type: 'chatReloaded', id: 'c', transcript: theirs })!;
    expect(s.chats.c).toEqual({ saved: theirs, current: theirs });
    expect(isDirty(s)).toBe(false);
  });

  it('reloading the structure drops chats whose item vanished', () => {
    let s = loaded([aiChat('a'), aiChat('b', 1)], { a: fresh(), b: fresh() });
    s = projectReducer(s, { type: 'structureReloaded', manifest: s.manifest, tree: { items: [aiChat('a')] }, bible: emptyBible() })!;
    expect(Object.keys(s.chats)).toEqual(['a']);
  });
});
