import { vi } from 'vitest';
import { emptyBible } from '@/bible/normalize';
import type {
  Bible, ExternalChange, ImportedAsset, IpcResult, MediaKind, OpenedProject, ProjectManifest, ProjectTree, RecentProject,
  SavePayload, TextImport, UnsavedChoice,
} from '@/project/types';
import type { AiSettingsPatch, AiStatus, ChatEvent, ChatRequest, ModelInfo, ProviderId, StreamEvent } from '@/ai/types';

const ok = <T,>(value: T): Promise<IpcResult<T>> => Promise.resolve({ ok: true, value });

export function makeAiStatus(overrides: Partial<AiStatus> = {}): AiStatus {
  return {
    enabled: false,
    defaultProvider: null,
    defaultModel: null,
    encryptionAvailable: true,
    providers: {
      gemini: { configured: false, lastTestOk: null },
      anthropic: { configured: false, lastTestOk: null },
      openai: { configured: false, lastTestOk: null },
    },
    keyStoreProblem: null,
    ...overrides,
  };
}

export function makeOpened(overrides: Partial<OpenedProject> = {}): OpenedProject {
  return {
    root: 'C:\\Research\\Saga.vrs',
    manifest: { schemaVersion: 2, id: 'p1', name: 'Saga', createdAt: 'T0', updatedAt: 'T0', settings: {} },
    tree: { items: [] },
    bible: emptyBible(),
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
  const chatListeners = new Set<(payload: ChatEvent) => void>();

  const fake = {
    nextDialogResult: null as OpenedProject | null,
    unsavedChoice: 'save' as UnsavedChoice,
    recents: [] as RecentProject[],
    disk: {
      manifest: null as ProjectManifest | null,
      tree: { items: [] } as ProjectTree,
      bible: emptyBible() as Bible,
      docs: {} as Record<string, string>,
      assets: {} as Record<string, Uint8Array>,
    },
    /** What the next media-import dialog "picks" (null = cancelled). */
    nextImport: null as ImportedAsset | null,
    nextTextImport: null as TextImport | null,
    /** What the next export dialog returns as the saved path (null = cancelled). */
    nextExportPath: null as string | null,
    exports: [] as string[],
    openedLinks: [] as string[],
    saves: [] as SavePayload[],
    recoveryWrites: [] as SavePayload[],
    saveError: null as string | null,
    /** The AI layer's main-process state; push stream events with `ai.emitChatEvent`. */
    ai: {
      status: makeAiStatus(),
      models: {} as Partial<Record<ProviderId, ModelInfo[]>>,
      startedChats: [] as { requestId: string; request: ChatRequest }[],
      cancelledChats: [] as string[],
      emitChatEvent(requestId: string, event: StreamEvent) {
        chatListeners.forEach(l => l({ requestId, event }));
      },
    },

    load(project: OpenedProject, docs: Record<string, string> = {}) {
      fake.disk = { ...fake.disk, manifest: project.manifest, tree: project.tree, bible: project.bible, docs };
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
      openExternal: vi.fn((url: string) => {
        fake.openedLinks.push(url);
        return ok(undefined);
      }),
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
      readStructure: vi.fn(() => ok({ manifest: fake.disk.manifest!, tree: fake.disk.tree, bible: fake.disk.bible })),
      readAsset: vi.fn((name: string): Promise<IpcResult<Uint8Array>> => {
        const bytes = fake.disk.assets[name];
        if (!bytes) return Promise.resolve({ ok: false, error: { code: 'NOT_FOUND', message: `${name} is missing` } });
        return ok(bytes);
      }),
      importMedia: vi.fn((_kind: MediaKind) => {
        const picked = fake.nextImport;
        if (picked) fake.disk.assets[picked.asset] = new Uint8Array([1, 2, 3]);
        return ok(picked);
      }),
      importText: vi.fn(() => ok(fake.nextTextImport)),
      exportDossier: vi.fn((markdown: string) => {
        if (fake.nextExportPath) fake.exports.push(markdown);
        return ok(fake.nextExportPath);
      }),
      save: vi.fn((payload: SavePayload): Promise<IpcResult<{ manifest: ProjectManifest }>> => {
        if (fake.saveError) return Promise.resolve({ ok: false, error: { code: 'IO', message: fake.saveError } });
        fake.saves.push(payload);
        for (const [id, body] of Object.entries(payload.docs ?? {})) {
          if (body === null) delete fake.disk.docs[id];
          else fake.disk.docs[id] = body;
        }
        if (payload.tree) fake.disk.tree = payload.tree;
        if (payload.bible) fake.disk.bible = payload.bible;
        for (const name of payload.deletedAssets ?? []) delete fake.disk.assets[name];
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
    ai: {
      getSettings: vi.fn(() => ok(fake.ai.status)),
      setSettings: vi.fn((patch: AiSettingsPatch) => {
        fake.ai.status = { ...fake.ai.status, ...patch };
        return ok(fake.ai.status);
      }),
      saveKey: vi.fn((provider: ProviderId, _key: string) => {
        fake.ai.status.providers[provider] = { configured: true, lastTestOk: 'T0' };
        return ok(fake.ai.status);
      }),
      removeKey: vi.fn((provider: ProviderId) => {
        fake.ai.status.providers[provider] = { configured: false, lastTestOk: null };
        if (!Object.values(fake.ai.status.providers).some(p => p.configured)) fake.ai.status.enabled = false;
        return ok(fake.ai.status);
      }),
      testKey: vi.fn((_provider: ProviderId) => ok(fake.ai.status)),
      listModels: vi.fn((provider: ProviderId, _options?: { refresh?: boolean }) => ok(fake.ai.models[provider] ?? [])),
      startChat: vi.fn((requestId: string, request: ChatRequest) => {
        fake.ai.startedChats.push({ requestId, request });
        return ok(requestId);
      }),
      cancelChat: vi.fn((requestId: string) => {
        fake.ai.cancelledChats.push(requestId);
        return ok(undefined);
      }),
      cancelAll: vi.fn(() => ok(undefined)),
      onChatEvent: vi.fn((cb: (payload: ChatEvent) => void) => {
        chatListeners.add(cb);
        return () => chatListeners.delete(cb);
      }),
    },
  } satisfies VrsApi;

  return { bridge, fake };
}
