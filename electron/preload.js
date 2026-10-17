// Sandboxed preload: only `require('electron')` is available here. Every
// capability the renderer gets must be an explicit, narrow function below --
// never expose ipcRenderer itself.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('vrs', {
  app: {
    getVersion: () => ipcRenderer.invoke('app:get-version'),
  },
});
