import { describe, it, expect } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useProject, STRUCTURE_CONFLICT } from '@/project/useProject';
import { createProjectApi } from '@/project/api';
import { createFakeBridge, makeOpened } from '@/test/fakeBridge';

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

  it('importText returns the picked text, or null on cancel', async () => {
    const ctx = setup();
    ctx.fake.nextDialogResult = makeOpened();
    await act(() => ctx.hook.result.current.openProject());
    ctx.fake.nextTextImport = { title: 'T', text: 'x', fileName: 'T.txt' };
    let r: unknown;
    await act(async () => { r = await ctx.hook.result.current.importText(); });
    expect(r).toEqual({ title: 'T', text: 'x', fileName: 'T.txt' });
    ctx.fake.nextTextImport = null;
    await act(async () => { r = await ctx.hook.result.current.importText(); });
    expect(r).toBeNull();
  });
});
