import { vi } from 'vitest';
import type {
  ExternalChange, IpcResult, OpenedProject, ProjectManifest, ProjectTree, RecentProject, SavePayload, UnsavedChoice,
} from '@/project/types';

const ok = <T,>(value: T): Promise<IpcResult<T>> => Promise.resolve({ ok: true, value });

export function makeOpened(overrides: Partial<OpenedProject> = {}): OpenedProject {
  return {
    root: 'C:\\Research\\Saga.vrs',
    manifest: { schemaVersion: 1, id: 'p1', name: 'Saga', createdAt: 'T0', updatedAt: 'T0', settings: {} },
    tree: { items: [] },
    migratedFrom: null,
    recovery: null,
    ...overrides,
  };
}

/**
 * An in-memory stand-in for the preload bridge (window.vrs). `disk` plays the
 * project folder; tests drive dialogs via `nextDialogResult` / `unsavedChoice`
 * and push main-process events with `emitExternalChange` / `emitSaveBeforeClose`.
 */
export function createFakeBridge() {
  const externalListeners = new Set<(changes: ExternalChange[]) => void>();
  const closeListeners = new Set<() => void>();

  const fake = {
    nextDialogResult: null as OpenedProject | null,
    unsavedChoice: 'save' as UnsavedChoice,
    recents: [] as RecentProject[],
    disk: {
      manifest: null as ProjectManifest | null,
      tree: { items: [] } as ProjectTree,
      docs: {} as Record<string, string>,
    },
    saves: [] as SavePayload[],
    recoveryWrites: [] as SavePayload[],
    saveError: null as string | null,

    load(project: OpenedProject, docs: Record<string, string> = {}) {
      fake.disk = { manifest: project.manifest, tree: project.tree, docs };
    },
    emitExternalChange(changes: ExternalChange[]) {
      externalListeners.forEach(l => l(changes));
    },
    emitSaveBeforeClose() {
      closeListeners.forEach(l => l());
    },
  };

  const openDialog = vi.fn(() => {
    const result = fake.nextDialogResult;
    if (result) fake.load(result, fake.disk.docs);
    return ok(result);
  });

  const bridge = {
    app: {
      getVersion: vi.fn(() => Promise.resolve('9.9.9')),
      onSaveBeforeClose: vi.fn((cb: () => void) => {
        closeListeners.add(cb);
        return () => closeListeners.delete(cb);
      }),
      closeConfirmed: vi.fn(() => ok(undefined)),
    },
    project: {
      create: openDialog,
      open: openDialog,
      openRecent: vi.fn((_root: string) => openDialog() as Promise<IpcResult<OpenedProject>>),
      listRecent: vi.fn(() => ok(fake.recents)),
      removeRecent: vi.fn((root: string) => {
        fake.recents = fake.recents.filter(r => r.root !== root);
        return ok(undefined);
      }),
      close: vi.fn((_options?: { discardRecovery?: boolean }) => ok(undefined)),
      readDoc: vi.fn((id: string) => ok(fake.disk.docs[id] ?? '')),
      readStructure: vi.fn(() => ok({ manifest: fake.disk.manifest!, tree: fake.disk.tree })),
      save: vi.fn((payload: SavePayload): Promise<IpcResult<{ manifest: ProjectManifest }>> => {
        if (fake.saveError) return Promise.resolve({ ok: false, error: { code: 'IO', message: fake.saveError } });
        fake.saves.push(payload);
        for (const [id, body] of Object.entries(payload.docs ?? {})) {
          if (body === null) delete fake.disk.docs[id];
          else fake.disk.docs[id] = body;
        }
        if (payload.tree) fake.disk.tree = payload.tree;
        fake.disk.manifest = { ...fake.disk.manifest!, ...payload.manifest, updatedAt: `T${fake.saves.length}` };
        return ok({ manifest: fake.disk.manifest });
      }),
      writeRecovery: vi.fn((snapshot: SavePayload) => {
        fake.recoveryWrites.push(snapshot);
        return ok(undefined);
      }),
      discardRecovery: vi.fn(() => ok(undefined)),
      setDirty: vi.fn((_dirty: boolean) => ok(undefined)),
      confirmUnsaved: vi.fn(() => ok(fake.unsavedChoice)),
      onExternalChange: vi.fn((cb: (changes: ExternalChange[]) => void) => {
        externalListeners.add(cb);
        return () => externalListeners.delete(cb);
      }),
    },
  } satisfies VrsApi;

  return { bridge, fake };
}
