// Sandboxed preload: only `require('electron')` is available here. Every
// capability the renderer gets must be an explicit, narrow function below --
// never expose ipcRenderer itself.
const { contextBridge, ipcRenderer } = require('electron');

/** Subscribes to a main-process event; returns an unsubscribe function. */
function subscribe(channel, callback) {
  const listener = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld('vrs', {
  app: {
    getVersion: () => ipcRenderer.invoke('app:get-version'),
    onSaveBeforeClose: (callback) => subscribe('app:save-before-close', callback),
    closeConfirmed: () => ipcRenderer.invoke('app:close-confirmed'),
    // Only http(s) URLs; the main process validates and hands them to the system browser.
    openExternal: (url) => ipcRenderer.invoke('app:open-external', url),
  },
  // Project roots only ever come from native dialogs or the recent list (see
  // electron/lib/projectSession.js); the renderer can't name an arbitrary folder.
  project: {
    create: () => ipcRenderer.invoke('project:create'),
    open: () => ipcRenderer.invoke('project:open'),
    openRecent: (root) => ipcRenderer.invoke('project:open-recent', root),
    listRecent: () => ipcRenderer.invoke('project:list-recent'),
    removeRecent: (root) => ipcRenderer.invoke('project:remove-recent', root),
    close: (options) => ipcRenderer.invoke('project:close', options),
    readDoc: (id) => ipcRenderer.invoke('project:read-doc', id),
    readChat: (id) => ipcRenderer.invoke('project:read-chat', id),
    readStructure: () => ipcRenderer.invoke('project:read-structure'),
    readAsset: (name) => ipcRenderer.invoke('project:read-asset', name),
    // Shows a native open dialog; the main process copies the pick into assets/.
    importMedia: (kind) => ipcRenderer.invoke('project:import-media', kind),
    // Shows a native open dialog for chat transcripts (several at once); the main process reads them.
    importTexts: () => ipcRenderer.invoke('project:import-texts'),
    // Shows a native save dialog for a Markdown export outside the project.
    exportDossier: (markdown) => ipcRenderer.invoke('project:export-dossier', markdown),
    save: (payload) => ipcRenderer.invoke('project:save', payload),
    writeRecovery: (snapshot) => ipcRenderer.invoke('project:write-recovery', snapshot),
    discardRecovery: () => ipcRenderer.invoke('project:discard-recovery'),
    setDirty: (dirty) => ipcRenderer.invoke('project:set-dirty', dirty),
    confirmUnsaved: () => ipcRenderer.invoke('project:confirm-unsaved'),
    onExternalChange: (callback) => subscribe('project:external-change', callback),
  },
  // Opt-in AI. Provider HTTP and API keys stay in the main process; keys are
  // sent in once (saveKey) and never come back.
  ai: {
    getSettings: () => ipcRenderer.invoke('settings:get-ai'),
    setSettings: (patch) => ipcRenderer.invoke('settings:set-ai', patch),
    saveKey: (provider, key) => ipcRenderer.invoke('llm:save-key', provider, key),
    removeKey: (provider) => ipcRenderer.invoke('llm:remove-key', provider),
    testKey: (provider) => ipcRenderer.invoke('llm:test', provider),
    listModels: (provider, options) => ipcRenderer.invoke('llm:list-models', provider, options),
    startChat: (requestId, request) => ipcRenderer.invoke('llm:chat-start', requestId, request),
    cancelChat: (requestId) => ipcRenderer.invoke('llm:chat-cancel', requestId),
    cancelAll: () => ipcRenderer.invoke('llm:cancel-all'),
    onChatEvent: (callback) => subscribe('llm:chat-event', callback),
    extract: (requestId, request) => ipcRenderer.invoke('llm:extract', requestId, request),
    cancelExtract: (requestId) => ipcRenderer.invoke('llm:extract-cancel', requestId),
  },
});
