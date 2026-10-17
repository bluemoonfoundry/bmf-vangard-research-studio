import { describe, it, expect } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useProject } from '@/project/useProject';
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
