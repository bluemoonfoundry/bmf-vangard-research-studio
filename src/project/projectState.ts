import type { Bible, OpenedProject, ProjectManifest, ProjectTree, RecoverySnapshot, SavePayload, TreeItem } from '@/project/types';
import { removeEntities } from '@/bible/ops';
import { descendantIds, moveItem, type DropPosition } from '@/workspace/treeOps';

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
  bible: Bible;
  savedBible: Bible;
  /** Loaded documents only; bodies are read on demand. */
  docs: Record<string, DocEntry>;
  /** Ids removed from the tree since the last save whose files may exist on disk. */
  deletedDocs: string[];
  /**
   * Asset files no longer wanted (deleted items, replaced or abandoned imports).
   * They ride along with the next save, which keeps any still referenced; they
   * don't make the project dirty on their own.
   */
  deletedAssets: string[];
}

export type ProjectAction =
  | { type: 'opened'; project: OpenedProject }
  | { type: 'closed' }
  | { type: 'docLoaded'; id: string; content: string }
  | { type: 'docEdited'; id: string; content: string }
  | { type: 'docsLoaded'; docs: Record<string, string> }
  | { type: 'docAdded'; item: TreeItem }
  | { type: 'itemsAdded'; items: TreeItem[]; docs: Record<string, string> }
  | { type: 'itemRenamed'; id: string; title: string }
  | { type: 'itemUpdated'; id: string; patch: Partial<TreeItem> }
  | { type: 'itemMoved'; id: string; targetId: string | null; position: DropPosition }
  | { type: 'itemDeleted'; id: string }
  | { type: 'bibleUpdated'; update: (b: Bible) => Bible }
  | { type: 'assetDiscarded'; asset: string }
  | { type: 'projectRenamed'; name: string }
  | { type: 'saved'; payload: SavePayload; manifest: ProjectManifest }
  | { type: 'recoveryRestored'; snapshot: RecoverySnapshot; diskDocs: Record<string, string> }
  | { type: 'docReloaded'; id: string; content: string }
  | { type: 'docDiskChanged'; id: string; content: string }
  | { type: 'structureReloaded'; manifest: ProjectManifest; tree: ProjectTree; bible: Bible };

const withAsset = (list: string[], asset: string | undefined) =>
  asset && !list.includes(asset) ? [...list, asset] : list;

function addItems(state: ProjectState, items: TreeItem[], bodies: Record<string, string>): ProjectState {
  const docs = { ...state.docs };
  for (const item of items) docs[item.id] = { saved: null, current: bodies[item.id] ?? '' };
  return { ...state, tree: { ...state.tree, items: [...state.tree.items, ...items] }, docs };
}

function updateItems(state: ProjectState, update: (item: TreeItem) => TreeItem): ProjectState {
  let changed = false;
  const items = state.tree.items.map((item) => {
    const next = update(item);
    if (next !== item) changed = true;
    return next;
  });
  return changed ? { ...state, tree: { ...state.tree, items } } : state;
}

export function projectReducer(state: ProjectState | null, action: ProjectAction): ProjectState | null {
  if (action.type === 'opened') {
    const { root, manifest, tree, bible } = action.project;
    return { root, manifest, savedName: manifest.name, tree, savedTree: tree, bible, savedBible: bible, docs: {}, deletedDocs: [], deletedAssets: [] };
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

    case 'docsLoaded': {
      const ids = new Set(state.tree.items.map(i => i.id));
      const docs = { ...state.docs };
      for (const [id, content] of Object.entries(action.docs)) {
        if (ids.has(id) && !docs[id]) docs[id] = { saved: content, current: content };
      }
      return { ...state, docs };
    }

    case 'docAdded':
      return addItems(state, [action.item], {});

    case 'itemsAdded':
      return addItems(state, action.items, action.docs);

    case 'itemRenamed':
      return updateItems(state, i => (i.id === action.id ? { ...i, title: action.title } : i));

    case 'itemUpdated':
      return updateItems(state, i => (i.id === action.id ? { ...i, ...action.patch, id: i.id } : i));

    case 'itemMoved': {
      const items = moveItem(state.tree.items, action.id, action.targetId, action.position);
      return items ? { ...state, tree: { ...state.tree, items } } : state;
    }

    case 'itemDeleted': {
      const removed = descendantIds(state.tree.items, action.id);
      const docs = { ...state.docs };
      const deletedDocs = [...state.deletedDocs];
      let deletedAssets = state.deletedAssets;
      const removedEntities = new Set<string>();
      for (const item of state.tree.items) {
        if (!removed.has(item.id)) continue;
        if (item.type === 'entity') removedEntities.add(item.id);
        // A document that was never loaded may still exist on disk.
        if (docs[item.id]?.saved !== null && !deletedDocs.includes(item.id)) deletedDocs.push(item.id);
        delete docs[item.id];
        deletedAssets = withAsset(deletedAssets, item.asset);
      }
      const items = state.tree.items
        .filter(i => !removed.has(i.id))
        .map(i => (i.references?.some(r => removed.has(r.targetId))
          ? { ...i, references: i.references.filter(r => !removed.has(r.targetId)) }
          : i));
      const bible = removedEntities.size ? removeEntities(state.bible, removedEntities) : state.bible;
      return { ...state, tree: { ...state.tree, items }, bible, docs, deletedDocs, deletedAssets };
    }

    case 'bibleUpdated': {
      const bible = action.update(state.bible);
      return bible === state.bible ? state : { ...state, bible };
    }

    case 'assetDiscarded':
      return { ...state, deletedAssets: withAsset(state.deletedAssets, action.asset) };

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
        savedBible: payload.bible ?? state.savedBible,
        docs,
        deletedDocs: state.deletedDocs.filter(id => payload.docs?.[id] !== null),
        deletedAssets: state.deletedAssets.filter(name => !payload.deletedAssets?.includes(name)),
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
        bible: snapshot.bible ?? state.bible,
        docs,
        deletedDocs,
        deletedAssets: (snapshot.deletedAssets ?? []).reduce(withAsset, state.deletedAssets),
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
        bible: action.bible,
        savedBible: action.bible,
        docs,
        deletedDocs: [],
        deletedAssets: [],
      };
    }
  }
}

export const isDocDirty = (state: ProjectState, id: string) => {
  const doc = state.docs[id];
  return !!doc && doc.current !== doc.saved;
};

export const isStructureDirty = (state: ProjectState) =>
  state.manifest.name !== state.savedName || state.tree !== state.savedTree || state.bible !== state.savedBible || state.deletedDocs.length > 0;

export const isDirty = (state: ProjectState | null) =>
  !!state && (isStructureDirty(state) || Object.keys(state.docs).some(id => isDocDirty(state, id)));

/** Everything unsaved, in the shape project:save (and recovery snapshots) accept. */
export function buildSavePayload(state: ProjectState): SavePayload {
  const payload: SavePayload = {};
  if (state.manifest.name !== state.savedName) payload.manifest = { name: state.manifest.name };
  if (state.tree !== state.savedTree) payload.tree = state.tree;
  if (state.bible !== state.savedBible) payload.bible = state.bible;

  const docs: Record<string, string | null> = {};
  for (const [id, doc] of Object.entries(state.docs)) {
    if (doc.current !== doc.saved) docs[id] = doc.current;
  }
  for (const id of state.deletedDocs) docs[id] = null;
  if (Object.keys(docs).length) payload.docs = docs;
  if (state.deletedAssets.length) payload.deletedAssets = state.deletedAssets;
  return payload;
}
