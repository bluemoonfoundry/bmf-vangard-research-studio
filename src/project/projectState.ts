import type { OpenedProject, ProjectManifest, ProjectTree, RecoverySnapshot, SavePayload, TreeItem } from '@/project/types';

/** A document body the renderer has loaded. `saved` is null for a document that has never been written. */
export interface DocEntry {
  saved: string | null;
  current: string;
}

/**
 * The open project as the renderer edits it. Each part keeps its last-saved
 * value alongside the current one, so dirtiness is a comparison rather than a
 * flag that can drift, and a save marks clean exactly what it wrote.
 */
export interface ProjectState {
  root: string;
  manifest: ProjectManifest;
  savedName: string;
  tree: ProjectTree;
  savedTree: ProjectTree;
  /** Loaded documents only; bodies are read on demand. */
  docs: Record<string, DocEntry>;
  /** Ids removed from the tree since the last save whose files may exist on disk. */
  deletedDocs: string[];
}

export type ProjectAction =
  | { type: 'opened'; project: OpenedProject }
  | { type: 'closed' }
  | { type: 'docLoaded'; id: string; content: string }
  | { type: 'docEdited'; id: string; content: string }
  | { type: 'docAdded'; item: TreeItem }
  | { type: 'itemRenamed'; id: string; title: string }
  | { type: 'itemDeleted'; id: string }
  | { type: 'projectRenamed'; name: string }
  | { type: 'saved'; payload: SavePayload; manifest: ProjectManifest }
  | { type: 'recoveryRestored'; snapshot: RecoverySnapshot; diskDocs: Record<string, string> }
  | { type: 'docReloaded'; id: string; content: string }
  | { type: 'docDiskChanged'; id: string; content: string }
  | { type: 'structureReloaded'; manifest: ProjectManifest; tree: ProjectTree };

function descendantsOf(items: TreeItem[], id: string): Set<string> {
  const ids = new Set([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const item of items) {
      if (item.parentId !== null && ids.has(item.parentId) && !ids.has(item.id)) {
        ids.add(item.id);
        grew = true;
      }
    }
  }
  return ids;
}

export function projectReducer(state: ProjectState | null, action: ProjectAction): ProjectState | null {
  if (action.type === 'opened') {
    const { root, manifest, tree } = action.project;
    return { root, manifest, savedName: manifest.name, tree, savedTree: tree, docs: {}, deletedDocs: [] };
  }
  if (!state) return state;

  switch (action.type) {
    case 'closed':
      return null;

    case 'docLoaded':
      if (state.docs[action.id]) return state;
      return { ...state, docs: { ...state.docs, [action.id]: { saved: action.content, current: action.content } } };

    case 'docEdited': {
      const doc = state.docs[action.id];
      if (!doc) return state;
      return { ...state, docs: { ...state.docs, [action.id]: { ...doc, current: action.content } } };
    }

    case 'docAdded':
      return {
        ...state,
        tree: { ...state.tree, items: [...state.tree.items, action.item] },
        docs: { ...state.docs, [action.item.id]: { saved: null, current: '' } },
      };

    case 'itemRenamed':
      return {
        ...state,
        tree: {
          ...state.tree,
          items: state.tree.items.map(i => (i.id === action.id ? { ...i, title: action.title } : i)),
        },
      };

    case 'itemDeleted': {
      const removed = descendantsOf(state.tree.items, action.id);
      const docs = { ...state.docs };
      const deletedDocs = [...state.deletedDocs];
      for (const id of removed) {
        if (docs[id]?.saved !== null && !deletedDocs.includes(id)) deletedDocs.push(id);
        delete docs[id];
      }
      return {
        ...state,
        tree: { ...state.tree, items: state.tree.items.filter(i => !removed.has(i.id)) },
        docs,
        deletedDocs,
      };
    }

    case 'projectRenamed':
      return { ...state, manifest: { ...state.manifest, name: action.name } };

    case 'saved': {
      const { payload } = action;
      const docs = { ...state.docs };
      for (const [id, body] of Object.entries(payload.docs ?? {})) {
        if (body !== null && docs[id]) docs[id] = { ...docs[id], saved: body };
      }
      return {
        ...state,
        manifest: { ...action.manifest, name: state.manifest.name },
        savedName: payload.manifest?.name ?? state.savedName,
        savedTree: payload.tree ?? state.savedTree,
        docs,
        deletedDocs: state.deletedDocs.filter(id => payload.docs?.[id] !== null),
      };
    }

    case 'recoveryRestored': {
      const { snapshot, diskDocs } = action;
      const docs = { ...state.docs };
      const deletedDocs = [...state.deletedDocs];
      for (const [id, body] of Object.entries(snapshot.docs ?? {})) {
        if (body === null) {
          delete docs[id];
          if (!deletedDocs.includes(id)) deletedDocs.push(id);
        } else {
          docs[id] = { saved: id in diskDocs ? diskDocs[id] : null, current: body };
        }
      }
      return {
        ...state,
        manifest: snapshot.manifest ? { ...state.manifest, name: snapshot.manifest.name } : state.manifest,
        tree: snapshot.tree ?? state.tree,
        docs,
        deletedDocs,
      };
    }

    case 'docReloaded':
      return { ...state, docs: { ...state.docs, [action.id]: { saved: action.content, current: action.content } } };

    case 'docDiskChanged': {
      const doc = state.docs[action.id];
      if (!doc) return state;
      return { ...state, docs: { ...state.docs, [action.id]: { ...doc, saved: action.content } } };
    }

    case 'structureReloaded': {
      const ids = new Set(action.tree.items.map(i => i.id));
      const docs = Object.fromEntries(Object.entries(state.docs).filter(([id]) => ids.has(id)));
      return {
        ...state,
        manifest: action.manifest,
        savedName: action.manifest.name,
        tree: action.tree,
        savedTree: action.tree,
        docs,
        deletedDocs: [],
      };
    }
  }
}

export const isDocDirty = (state: ProjectState, id: string) => {
  const doc = state.docs[id];
  return !!doc && doc.current !== doc.saved;
};

export const isStructureDirty = (state: ProjectState) =>
  state.manifest.name !== state.savedName || state.tree !== state.savedTree || state.deletedDocs.length > 0;

export const isDirty = (state: ProjectState | null) =>
  !!state && (isStructureDirty(state) || Object.keys(state.docs).some(id => isDocDirty(state, id)));

/** Everything unsaved, in the shape project:save (and recovery snapshots) accept. */
export function buildSavePayload(state: ProjectState): SavePayload {
  const payload: SavePayload = {};
  if (state.manifest.name !== state.savedName) payload.manifest = { name: state.manifest.name };
  if (state.tree !== state.savedTree) payload.tree = state.tree;

  const docs: Record<string, string | null> = {};
  for (const [id, doc] of Object.entries(state.docs)) {
    if (doc.current !== doc.saved) docs[id] = doc.current;
  }
  for (const id of state.deletedDocs) docs[id] = null;
  if (Object.keys(docs).length) payload.docs = docs;
  return payload;
}
