import type { IpcResult } from '@/project/types';

/** A failed project operation, carrying the main process's error code (NOT_A_PROJECT, TOO_NEW, ...). */
export class ProjectError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ProjectError';
  }
}

export async function unwrap<T>(pending: Promise<IpcResult<T>>): Promise<T> {
  const result = await pending;
  if (!result.ok) throw new ProjectError(result.error.code, result.error.message);
  return result.value;
}

type RawProjectApi = VrsApi['project'];

/** The preload's project API with each `{ ok, value | error }` envelope unwrapped into a value or a thrown ProjectError. */
export type ProjectApi = {
  [K in keyof RawProjectApi]: RawProjectApi[K] extends (...args: infer A) => Promise<IpcResult<infer R>>
    ? (...args: A) => Promise<R>
    : RawProjectApi[K];
};

/** Opens an http(s) link in the system browser, via the main process. */
export function openExternal(bridge: VrsApi | undefined, url: string): Promise<void> {
  if (!bridge) return Promise.reject(new ProjectError('UNAVAILABLE', 'Links open only in the desktop app.'));
  return unwrap(bridge.app.openExternal(url));
}

export function createProjectApi(bridge: VrsApi): ProjectApi {
  const raw = bridge.project;
  return {
    create: () => unwrap(raw.create()),
    open: () => unwrap(raw.open()),
    openRecent: (root) => unwrap(raw.openRecent(root)),
    listRecent: () => unwrap(raw.listRecent()),
    removeRecent: (root) => unwrap(raw.removeRecent(root)),
    close: (options) => unwrap(raw.close(options)),
    readDoc: (id) => unwrap(raw.readDoc(id)),
    readChat: (id) => unwrap(raw.readChat(id)),
    readStructure: () => unwrap(raw.readStructure()),
    readAsset: (name) => unwrap(raw.readAsset(name)),
    importMedia: (kind) => unwrap(raw.importMedia(kind)),
    importText: () => unwrap(raw.importText()),
    exportDossier: (markdown) => unwrap(raw.exportDossier(markdown)),
    save: (payload) => unwrap(raw.save(payload)),
    writeRecovery: (snapshot) => unwrap(raw.writeRecovery(snapshot)),
    discardRecovery: () => unwrap(raw.discardRecovery()),
    setDirty: (dirty) => unwrap(raw.setDirty(dirty)),
    confirmUnsaved: () => unwrap(raw.confirmUnsaved()),
    onExternalChange: (callback) => raw.onExternalChange(callback),
  };
}
