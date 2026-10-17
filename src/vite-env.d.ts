/// <reference types="vite/client" />

/** API exposed by electron/preload.js. Absent when the renderer runs in a plain browser (`npm run dev`). */
interface VrsApi {
  app: {
    getVersion(): Promise<string>;
  };
}

interface Window {
  vrs?: VrsApi;
}
