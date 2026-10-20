/// <reference types="vite/client" />

type VrsIpcResult<T> = import('@/project/types').IpcResult<T>;

/** API exposed by electron/preload.js. Absent when the renderer runs in a plain browser (`npm run dev`). */
interface VrsApi {
  app: {
    getVersion(): Promise<string>;
    onSaveBeforeClose(callback: () => void): () => void;
    closeConfirmed(): Promise<VrsIpcResult<void>>;
    openExternal(url: string): Promise<VrsIpcResult<void>>;
    getTheme(): Promise<VrsIpcResult<import('@/settings/theme').Theme>>;
    /** Stores and applies the theme; the main process sets nativeTheme, so CSS follows `prefers-color-scheme`. */
    setTheme(theme: import('@/settings/theme').Theme): Promise<VrsIpcResult<import('@/settings/theme').Theme>>;
  };
  project: {
    create(): Promise<VrsIpcResult<import('@/project/types').OpenedProject | null>>;
    open(): Promise<VrsIpcResult<import('@/project/types').OpenedProject | null>>;
    openRecent(root: string): Promise<VrsIpcResult<import('@/project/types').OpenedProject>>;
    listRecent(): Promise<VrsIpcResult<import('@/project/types').RecentProject[]>>;
    removeRecent(root: string): Promise<VrsIpcResult<void>>;
    close(options?: { discardRecovery?: boolean }): Promise<VrsIpcResult<void>>;
    readDoc(id: string): Promise<VrsIpcResult<string>>;
    readChat(id: string): Promise<VrsIpcResult<{ transcript: import('@/chat/types').ChatTranscript | null; problem: string | null }>>;
    readStructure(): Promise<VrsIpcResult<{
      manifest: import('@/project/types').ProjectManifest;
      tree: import('@/project/types').ProjectTree;
      bible: import('@/project/types').Bible;
      extraction?: import('@/extraction/types').ExtractionState;
    }>>;
    checkAsset(name: string): Promise<VrsIpcResult<{ bytes: number }>>;
    importMedia(kind: import('@/project/types').MediaKind): Promise<VrsIpcResult<import('@/project/types').ImportedAsset | null>>;
    importTexts(): Promise<VrsIpcResult<import('@/project/types').TextImportBatch | null>>;
    exportDossier(markdown: string): Promise<VrsIpcResult<string | null>>;
    save(payload: import('@/project/types').SavePayload): Promise<VrsIpcResult<{ manifest: import('@/project/types').ProjectManifest }>>;
    writeRecovery(snapshot: import('@/project/types').SavePayload): Promise<VrsIpcResult<void>>;
    discardRecovery(): Promise<VrsIpcResult<void>>;
    setDirty(dirty: boolean): Promise<VrsIpcResult<void>>;
    confirmUnsaved(): Promise<VrsIpcResult<import('@/project/types').UnsavedChoice>>;
    onExternalChange(callback: (changes: import('@/project/types').ExternalChange[]) => void): () => void;
  };
  /** Opt-in AI layer. Provider HTTP and API keys stay in the main process; keys never come back. */
  ai: {
    getSettings(): Promise<VrsIpcResult<import('@/ai/types').AiStatus>>;
    setSettings(patch: import('@/ai/types').AiSettingsPatch): Promise<VrsIpcResult<import('@/ai/types').AiStatus>>;
    saveKey(provider: import('@/ai/types').ProviderId, key: string): Promise<VrsIpcResult<import('@/ai/types').AiStatus>>;
    removeKey(provider: import('@/ai/types').ProviderId): Promise<VrsIpcResult<import('@/ai/types').AiStatus>>;
    /** Moves an unreadable key store aside and starts fresh; refused while it reads fine. */
    resetKeys(): Promise<VrsIpcResult<import('@/ai/types').AiStatus>>;
    testKey(provider: import('@/ai/types').ProviderId): Promise<VrsIpcResult<import('@/ai/types').AiStatus>>;
    listModels(provider: import('@/ai/types').ProviderId, options?: { refresh?: boolean }): Promise<VrsIpcResult<import('@/ai/types').ModelInfo[]>>;
    startChat(requestId: string, request: import('@/ai/types').ChatRequest): Promise<VrsIpcResult<string>>;
    cancelChat(requestId: string): Promise<VrsIpcResult<void>>;
    cancelAll(): Promise<VrsIpcResult<void>>;
    onChatEvent(callback: (payload: import('@/ai/types').ChatEvent) => void): () => void;
    extract(requestId: string, request: import('@/ai/types').ExtractRequest): Promise<VrsIpcResult<import('@/ai/types').ExtractResult>>;
    cancelExtract(requestId: string): Promise<VrsIpcResult<void>>;
    /** Semantic conflict check: the renderer builds the text; the main process adds the schema. */
    conflictCheck(requestId: string, request: import('@/ai/types').ExtractRequest): Promise<VrsIpcResult<import('@/ai/types').ConflictCheckResult>>;
    cancelConflictCheck(requestId: string): Promise<VrsIpcResult<void>>;
    /** The writer's saved personas (app-wide). */
    listPersonas(): Promise<VrsIpcResult<import('@/ai/types').PersonaPreset[]>>;
    /** Creates a preset, or updates the one with `id`. */
    savePersona(preset: import('@/ai/types').PersonaPresetInput): Promise<VrsIpcResult<import('@/ai/types').SavedPersona>>;
    deletePersona(id: string): Promise<VrsIpcResult<import('@/ai/types').PersonaPreset[]>>;
  };
}

interface Window {
  vrs?: VrsApi;
}
