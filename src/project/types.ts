/** Renderer-side shapes of the project format defined in electron/lib/projectSchema.js. */

export interface ProjectManifest {
  schemaVersion: number;
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  settings: Record<string, unknown>;
}

export interface TreeItem {
  id: string;
  parentId: string | null;
  type: string;
  title: string;
  order: number;
  keywords: string[];
  createdAt?: string;
  updatedAt?: string;
  [extra: string]: unknown;
}

export interface ProjectTree {
  items: TreeItem[];
}

/** What the renderer may write: the main process owns ids, versions and timestamps. */
export interface SavePayload {
  manifest?: { name: string; settings?: Record<string, unknown> };
  tree?: ProjectTree;
  /** Document bodies by item id; null deletes the document file. */
  docs?: Record<string, string | null>;
}

export interface RecoverySnapshot extends SavePayload {
  savedAt: string;
}

export interface OpenedProject {
  root: string;
  manifest: ProjectManifest;
  tree: ProjectTree;
  /** Schema version the project was upgraded from on open, or null. */
  migratedFrom: number | null;
  recovery: RecoverySnapshot | null;
}

export interface RecentProject {
  root: string;
  name: string;
  openedAt: string;
  missing: boolean;
}

export interface ExternalChange {
  /** Project-relative, forward slashes. */
  path: string;
  deleted: boolean;
}

export type UnsavedChoice = 'save' | 'discard' | 'cancel';

export type IpcResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: { code: string; message: string } };
