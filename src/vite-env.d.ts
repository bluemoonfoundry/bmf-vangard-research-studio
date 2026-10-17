/// <reference types="vite/client" />

type VrsIpcResult<T> = import('@/project/types').IpcResult<T>;

/** API exposed by electron/preload.js. Absent when the renderer runs in a plain browser (`npm run dev`). */
interface VrsApi {
  app: {
    getVersion(): Promise<string>;
    onSaveBeforeClose(callback: () => void): () => void;
    closeConfirmed(): Promise<VrsIpcResult<void>>;
    openExternal(url: string): Promise<VrsIpcResult<void>>;
  };
  project: {
    create(): Promise<VrsIpcResult<import('@/project/types').OpenedProject | null>>;
    open(): Promise<VrsIpcResult<import('@/project/types').OpenedProject | null>>;
    openRecent(root: string): Promise<VrsIpcResult<import('@/project/types').OpenedProject>>;
    listRecent(): Promise<VrsIpcResult<import('@/project/types').RecentProject[]>>;
    removeRecent(root: string): Promise<VrsIpcResult<void>>;
    close(options?: { discardRecovery?: boolean }): Promise<VrsIpcResult<void>>;
    readDoc(id: string): Promise<VrsIpcResult<string>>;
    readStructure(): Promise<VrsIpcResult<{
      manifest: import('@/project/types').ProjectManifest;
      tree: import('@/project/types').ProjectTree;
      bible: import('@/project/types').Bible;
    }>>;
    readAsset(name: string): Promise<VrsIpcResult<Uint8Array>>;
    importMedia(kind: import('@/project/types').MediaKind): Promise<VrsIpcResult<import('@/project/types').ImportedAsset | null>>;
    importText(): Promise<VrsIpcResult<import('@/project/types').TextImport | null>>;
    exportDossier(markdown: string): Promise<VrsIpcResult<string | null>>;
    save(payload: import('@/project/types').SavePayload): Promise<VrsIpcResult<{ manifest: import('@/project/types').ProjectManifest }>>;
    writeRecovery(snapshot: import('@/project/types').SavePayload): Promise<VrsIpcResult<void>>;
    discardRecovery(): Promise<VrsIpcResult<void>>;
    setDirty(dirty: boolean): Promise<VrsIpcResult<void>>;
    confirmUnsaved(): Promise<VrsIpcResult<import('@/project/types').UnsavedChoice>>;
    onExternalChange(callback: (changes: import('@/project/types').ExternalChange[]) => void): () => void;
  };
}

interface Window {
  vrs?: VrsApi;
}
