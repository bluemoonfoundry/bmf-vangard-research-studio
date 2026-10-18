import { describe, it, expect } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useProject, STRUCTURE_CONFLICT } from '@/project/useProject';
import { createProjectApi } from '@/project/api';
import { createFakeBridge, makeOpened } from '@/test/fakeBridge';
import { newTranscript, updateSettings } from '@/chat/transcript';
import type { TreeItem } from '@/project/types';

function setup() {
  const { bridge, fake } = createFakeBridge();
  const api = createProjectApi(bridge);
  const hook = renderHook(() => useProject(api, bridge.app));
  return { bridge, fake, hook };
}

async function openDirty({ fake, hook }: ReturnType<typeof setup>) {
  fake.nextDialogResult = makeOpened();
  await act(() => hook.result.current.openProject());
  act(() => hook.result.current.renameProject('Unsaved'));
  expect(hook.result.current.dirty).toBe(true);
}

describe('useProject: switching projects with unsaved changes', () => {
  it('drops the old snapshot before switching, so the new project keeps its own', async () => {
    const ctx = setup();
    await openDirty(ctx);
    ctx.fake.unsavedChoice = 'discard';
    const next = makeOpened({ root: 'C:/Other.vrs', manifest: { ...makeOpened().manifest, id: 'p2', name: 'Other' } });
    ctx.fake.nextDialogResult = next;

    const order: string[] = [];
    ctx.bridge.project.discardRecovery.mockImplementation(() => { order.push('discard'); return Promise.resolve({ ok: true, value: undefined }); });
    ctx.bridge.project.open.mockImplementation(() => { order.push('open'); return Promise.resolve({ ok: true, value: next }); });

    await act(() => ctx.hook.result.current.openProject());
    expect(order).toEqual(['discard', 'open']);
    expect(ctx.hook.result.current.state?.manifest.name).toBe('Other');
  });

  it('puts the snapshot back when the user then cancels the open dialog', async () => {
    const ctx = setup();
    await openDirty(ctx);
    ctx.fake.unsavedChoice = 'discard';
    ctx.fake.nextDialogResult = null;
    await act(() => ctx.hook.result.current.openProject());

    expect(ctx.bridge.project.discardRecovery).toHaveBeenCalled();
    expect(ctx.fake.recoveryWrites.at(-1)).toEqual({ manifest: { name: 'Unsaved' } });
    expect(ctx.hook.result.current.state?.manifest.name).toBe('Unsaved');
  });

  it('does not switch when saving the current project fails', async () => {
    const ctx = setup();
    await openDirty(ctx);
    ctx.fake.unsavedChoice = 'save';
    ctx.fake.saveError = 'Disk full';
    const openCalls = ctx.bridge.project.open.mock.calls.length;
    await act(() => ctx.hook.result.current.openProject());
    expect(ctx.bridge.project.open.mock.calls.length).toBe(openCalls);
    await waitFor(() => expect(ctx.hook.result.current.error).toMatch('Disk full'));
  });
});

describe('useProject: bible external changes', () => {
  it('flags a conflict when bible/bible.json changes while the bible is dirty', async () => {
    const ctx = setup();
    ctx.fake.nextDialogResult = makeOpened();
    await act(() => ctx.hook.result.current.openProject());
    act(() => ctx.hook.result.current.updateBible(b => ({ ...b, decisions: [...b.decisions] })));
    expect(ctx.hook.result.current.dirty).toBe(true);
    act(() => ctx.fake.emitExternalChange([{ path: 'bible/bible.json', deleted: false }]));
    await waitFor(() => expect(ctx.hook.result.current.conflicts).toContain(STRUCTURE_CONFLICT));
  });

  it('reloads when the bible is clean', async () => {
    const ctx = setup();
    ctx.fake.nextDialogResult = makeOpened();
    await act(() => ctx.hook.result.current.openProject());
    const bible = { facts: [], dependencies: [], decisions: [] };
    ctx.fake.disk.bible = { ...bible, dependencies: [{ id: 'd', eventId: 'a', afterEventId: 'b' }] };
    act(() => ctx.fake.emitExternalChange([{ path: 'bible/bible.json', deleted: false }]));
    await waitFor(() => expect(ctx.hook.result.current.state?.bible.dependencies).toHaveLength(1));
    expect(ctx.hook.result.current.dirty).toBe(false);
  });

  it('Keep mine on a structure conflict makes the next save write the whole structure', async () => {
    const ctx = setup();
    ctx.fake.nextDialogResult = makeOpened();
    await act(() => ctx.hook.result.current.openProject());
    act(() => ctx.hook.result.current.renameItem('nope', 'x'));
    act(() => ctx.hook.result.current.renameProject('Mine'));
    act(() => ctx.fake.emitExternalChange([{ path: 'bible/bible.json', deleted: false }]));
    await waitFor(() => expect(ctx.hook.result.current.conflicts).toContain(STRUCTURE_CONFLICT));
    await act(() => ctx.hook.result.current.keepMine(STRUCTURE_CONFLICT));
    await act(async () => { await ctx.hook.result.current.save(); });
    const payload = ctx.fake.saves.at(-1)!;
    expect(payload.manifest).toEqual({ name: 'Mine' });
    expect(payload.tree).toBeDefined();
    expect(payload.bible).toBeDefined();
  });

  it('importTexts returns the picked batch, or null on cancel', async () => {
    const ctx = setup();
    ctx.fake.nextDialogResult = makeOpened();
    await act(() => ctx.hook.result.current.openProject());
    const batch = { imports: [{ title: 'T', text: 'x', fileName: 'T.txt' }], skipped: [{ fileName: 'b.pdf', message: 'no' }] };
    ctx.fake.nextTextImports = batch;
    let r: unknown;
    await act(async () => { r = await ctx.hook.result.current.importTexts(); });
    expect(r).toEqual(batch);
    ctx.fake.nextTextImports = null;
    await act(async () => { r = await ctx.hook.result.current.importTexts(); });
    expect(r).toBeNull();
  });
});

describe('useProject: AI chats', () => {
  const DEFAULTS = { provider: 'openai' as const, model: 'gpt-x' };
  const node = (id: string, type: string, order = 0): TreeItem => ({ id, parentId: null, type, title: id, order, keywords: [] });
  const tree = { items: [node('d', 'document'), node('c1', 'ai-chat', 1), node('c2', 'ai-chat', 2), node('old', 'chat', 3)] };

  async function openWithChats() {
    const { bridge, fake } = createFakeBridge();
    const api = createProjectApi(bridge);
    const hook = renderHook(() => useProject(api, bridge.app, { chatDefaults: () => DEFAULTS }));
    fake.disk.chats = { c1: updateSettings(newTranscript(DEFAULTS), { webSearch: true }) };
    fake.nextDialogResult = makeOpened({ tree });
    await act(() => hook.result.current.openProject());
    await waitFor(() => expect(Object.keys(hook.result.current.state!.chats).sort()).toEqual(['c1', 'c2']));
    return { bridge, fake, hook };
  }

  it('loadAllChats reads only ai-chat items', async () => {
    const { bridge, hook } = await openWithChats();
    expect(bridge.project.readChat.mock.calls.map(c => c[0]).sort()).toEqual(['c1', 'c2']);
    const { chats } = hook.result.current.state!;
    expect(chats.c1.current.settings.webSearch).toBe(true);
    expect(chats.c2.current.settings).toMatchObject({ provider: 'openai', model: 'gpt-x' });
    expect(hook.result.current.dirty).toBe(false);
    await act(() => hook.result.current.loadAllChats());
    expect(bridge.project.readChat).toHaveBeenCalledTimes(2);
  });

  it('one unreadable chat does not block the others', async () => {
    const { bridge, fake } = createFakeBridge();
    const api = createProjectApi(bridge);
    const hook = renderHook(() => useProject(api, bridge.app, { chatDefaults: () => DEFAULTS }));
    fake.disk.chats = { c1: updateSettings(newTranscript(DEFAULTS), { webSearch: true }) };
    bridge.project.readChat.mockImplementation((id: string) => (id === 'c2'
      ? Promise.resolve({ ok: false, error: { code: 'IO', message: 'Bridge hiccup' } })
      : Promise.resolve({ ok: true, value: { transcript: fake.disk.chats[id] ?? null, problem: null } })));
    fake.nextDialogResult = makeOpened({ tree });
    await act(() => hook.result.current.openProject());
    await waitFor(() => expect(Object.keys(hook.result.current.state!.chats).sort()).toEqual(['c1', 'c2']));
    const { chats } = hook.result.current.state!;
    expect(chats.c1.current.settings.webSearch).toBe(true);
    expect(chats.c1.problem).toBeUndefined();
    // The failed chat carries the reason (so it opens read-only) and isn't re-read on every tree change.
    expect(chats.c2.problem).toMatch('Bridge hiccup');
    expect(hook.result.current.dirty).toBe(false);
    const calls = bridge.project.readChat.mock.calls.length;
    await act(() => hook.result.current.loadAllChats());
    expect(bridge.project.readChat.mock.calls.length).toBe(calls);
  });

  it('external change reloads a clean chat', async () => {
    const { fake, hook } = await openWithChats();
    const theirs = updateSettings(newTranscript(DEFAULTS), { readUrls: true });
    fake.disk.chats.c1 = theirs;
    act(() => fake.emitExternalChange([{ path: 'chats/c1.json', deleted: false }]));
    await waitFor(() => expect(hook.result.current.state?.chats.c1.current).toEqual(theirs));
    expect(hook.result.current.dirty).toBe(false);
    expect(hook.result.current.conflicts).toEqual([]);
  });

  it('external change on a dirty chat raises a conflict', async () => {
    const { fake, hook } = await openWithChats();
    act(() => hook.result.current.updateChat('c1', t => updateSettings(t, { filterMode: 'user_only' })));
    expect(hook.result.current.dirty).toBe(true);
    const theirs = updateSettings(newTranscript(DEFAULTS), { readUrls: true });
    fake.disk.chats.c1 = theirs;
    act(() => fake.emitExternalChange([{ path: 'chats/c1.json', deleted: false }]));
    await waitFor(() => expect(hook.result.current.conflicts).toEqual(['chats/c1.json']));
    expect(hook.result.current.state?.chats.c1.current.settings.filterMode).toBe('user_only');

    await act(() => hook.result.current.keepMine('chats/c1.json'));
    expect(hook.result.current.conflicts).toEqual([]);
    expect(hook.result.current.state?.chats.c1.saved).toEqual(theirs);
    expect(hook.result.current.dirty).toBe(true);

    act(() => fake.emitExternalChange([{ path: 'chats/c1.json', deleted: false }]));
    await waitFor(() => expect(hook.result.current.conflicts).toEqual(['chats/c1.json']));
    await act(() => hook.result.current.reloadFromDisk('chats/c1.json'));
    expect(hook.result.current.state?.chats.c1.current).toEqual(theirs);
    expect(hook.result.current.dirty).toBe(false);
  });

  it('addItem starts an ai-chat with the default transcript, and save writes it', async () => {
    const { fake, hook } = await openWithChats();
    let id = '';
    act(() => { id = hook.result.current.addItem({ type: 'ai-chat', title: 'Ask' }); });
    expect(hook.result.current.state?.chats[id]).toMatchObject({ saved: null, current: { settings: { provider: 'openai', model: 'gpt-x' } } });
    await act(async () => { await hook.result.current.save(); });
    expect(fake.disk.chats[id]).toBeDefined();
    expect(hook.result.current.dirty).toBe(false);
  });

  it('duplicateItem copies the transcript', async () => {
    const { hook } = await openWithChats();
    let copy: string | null = null;
    await act(async () => { copy = await hook.result.current.duplicateItem('c1'); });
    const { chats } = hook.result.current.state!;
    expect(chats[copy!]).toMatchObject({ saved: null, current: chats.c1.current });
  });

  it('restoring recovery reads the chats on disk underneath', async () => {
    const { bridge, fake } = createFakeBridge();
    const api = createProjectApi(bridge);
    const hook = renderHook(() => useProject(api, bridge.app, { chatDefaults: () => DEFAULTS }));
    const disk = newTranscript(DEFAULTS);
    const unsaved = updateSettings(newTranscript(DEFAULTS), { webSearch: true });
    fake.disk.chats = { c1: disk };
    fake.nextDialogResult = makeOpened({ tree, recovery: { savedAt: 'T', chats: { c1: unsaved } } });
    await act(() => hook.result.current.openProject());
    await act(() => hook.result.current.restoreRecovery());
    expect(hook.result.current.state?.chats.c1).toEqual({ saved: disk, current: unsaved });
    expect(hook.result.current.dirty).toBe(true);
  });
});
