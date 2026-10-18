import type { Bible, OpenedProject, ProjectManifest, ProjectTree, RecoverySnapshot, SavePayload, TreeItem } from '@/project/types';
import type { ProviderId } from '@/ai/types';
import { pruneOrphans, removeEntities } from '@/bible/ops';
import { appendSources, isSourceItem } from '@/bible/sourceOrder';
import { emptyExtraction, type Canon, type ExtractionState } from '@/extraction/types';
import { pruneExtraction } from '@/extraction/prune';
import { forPersistence, newTranscript, normalizeTranscript } from '@/chat/transcript';
import type { ChatTranscript } from '@/chat/types';
import { descendantIds, moveItem, type DropPosition } from '@/workspace/treeOps';

/** A document body the renderer has loaded. `saved` is null for a document that has never been written. */
export interface DocEntry {
  saved: string | null;
  current: string;
}

/**
 * A loaded AI chat transcript (chats/<id>.json). `saved` is null for a chat never written. Dirtiness
 * is identity: `saved` is the very object last loaded or written, so a reply that kept streaming
 * after a save began leaves the chat dirty. `problem` explains a damaged file opened as an empty chat.
 */
export interface ChatEntry {
  saved: ChatTranscript | null;
  current: ChatTranscript;
  problem?: string;
}

/** Item type of an AI chat (compared as a string: TreeItem.type is open-ended). */
export const AI_CHAT_TYPE = 'ai-chat';

/** Provider and model a chat starts with when it has no transcript yet. */
export interface ChatDefaults {
  provider: ProviderId | null;
  model: string | null;
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
  /** bible/extraction.json: AI extraction's pending proposals, rejections and run cache. */
  extraction: ExtractionState;
  savedExtraction: ExtractionState;
  /** Loaded documents only; bodies are read on demand. */
  docs: Record<string, DocEntry>;
  /** Ids removed from the tree since the last save whose files may exist on disk. */
  deletedDocs: string[];
  /** Loaded AI chat transcripts by item id. */
  chats: Record<string, ChatEntry>;
  /** AI chat ids removed from the tree since the last save whose transcript files may exist on disk. */
  deletedChats: string[];
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
  | { type: 'itemsAdded'; items: TreeItem[]; docs: Record<string, string>; chats?: Record<string, ChatTranscript> }
  | { type: 'chatsLoaded'; defaults: ChatDefaults; chats: Record<string, { transcript: ChatTranscript | null; problem: string | null }> }
  | { type: 'chatUpdated'; id: string; update: (t: ChatTranscript) => ChatTranscript }
  | { type: 'chatReloaded'; id: string; transcript: ChatTranscript; problem?: string | null }
  | { type: 'chatDiskChanged'; id: string; transcript: ChatTranscript }
  | { type: 'itemRenamed'; id: string; title: string }
  | { type: 'itemUpdated'; id: string; patch: Partial<TreeItem> }
  | { type: 'itemMoved'; id: string; targetId: string | null; position: DropPosition }
  | { type: 'itemDeleted'; id: string }
  | { type: 'bibleUpdated'; update: (b: Bible) => Bible }
  | { type: 'extractionUpdated'; update: (x: ExtractionState) => ExtractionState }
  | { type: 'canonUpdated'; update: (c: Canon) => Canon }
  | { type: 'assetDiscarded'; asset: string }
  | { type: 'projectRenamed'; name: string }
  | { type: 'saved'; payload: SavePayload; manifest: ProjectManifest }
  | { type: 'recoveryRestored'; snapshot: RecoverySnapshot; diskDocs: Record<string, string>; diskChats: Record<string, ChatTranscript> }
  | { type: 'docReloaded'; id: string; content: string }
  | { type: 'docDiskChanged'; id: string; content: string }
  | { type: 'structureKeptMine' }
  | { type: 'structureReloaded'; manifest: ProjectManifest; tree: ProjectTree; bible: Bible; extraction?: ExtractionState };

const withAsset = (list: string[], asset: string | undefined) =>
  asset && !list.includes(asset) ? [...list, asset] : list;

/** A chat entry matching what's on disk; a problem rides along so the chat can show a notice. */
const cleanChat = (t: ChatTranscript, problem?: string | null): ChatEntry =>
  (problem ? { saved: t, current: t, problem } : { saved: t, current: t });

const withChat = (state: ProjectState, id: string, entry: ChatEntry): ProjectState =>
  ({ ...state, chats: { ...state.chats, [id]: entry } });

function addItems(
  state: ProjectState, items: TreeItem[], bodies: Record<string, string>, transcripts: Record<string, ChatTranscript> = {},
): ProjectState {
  const docs = { ...state.docs };
  const chats = { ...state.chats };
  for (const item of items) {
    docs[item.id] = { saved: null, current: bodies[item.id] ?? '' };
    if (transcripts[item.id]) chats[item.id] = { saved: null, current: transcripts[item.id] };
  }
  // New chats, AI chats and documents join the source order as newest.
  const bible = appendSources(state.bible, items.filter(isSourceItem).map(i => i.id));
  return { ...state, tree: { ...state.tree, items: [...state.tree.items, ...items] }, docs, chats, bible };
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
    const extraction = action.project.extraction ?? emptyExtraction();
    return {
      root, manifest, savedName: manifest.name, tree, savedTree: tree, bible, savedBible: bible,
      extraction, savedExtraction: extraction,
      docs: {}, deletedDocs: [], chats: {}, deletedChats: [], deletedAssets: [],
    };
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
      return addItems(state, action.items, action.docs, action.chats);

    case 'chatsLoaded': {
      const ids = new Set(state.tree.items.map(i => i.id));
      const chats = { ...state.chats };
      for (const [id, { transcript, problem }] of Object.entries(action.chats)) {
        // A missing or damaged file opens as a clean empty chat, so nothing overwrites it until the user changes it.
        if (ids.has(id) && !chats[id]) chats[id] = cleanChat(transcript ?? newTranscript(action.defaults), problem);
      }
      return { ...state, chats };
    }

    case 'chatUpdated': {
      const chat = state.chats[action.id];
      if (!chat) return state;
      const current = action.update(chat.current);
      return current === chat.current ? state : withChat(state, action.id, { ...chat, current });
    }

    case 'chatReloaded':
      return withChat(state, action.id, cleanChat(action.transcript, action.problem));

    case 'chatDiskChanged': {
      const chat = state.chats[action.id];
      return chat ? withChat(state, action.id, { ...chat, saved: action.transcript }) : state;
    }

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
      const chats = { ...state.chats };
      const deletedChats = [...state.deletedChats];
      let deletedAssets = state.deletedAssets;
      const removedEntities = new Set<string>();
      for (const item of state.tree.items) {
        if (!removed.has(item.id)) continue;
        if (item.type === 'entity') removedEntities.add(item.id);
        // A document that was never loaded may still exist on disk.
        if (docs[item.id]?.saved !== null && !deletedDocs.includes(item.id)) deletedDocs.push(item.id);
        delete docs[item.id];
        if (item.type === AI_CHAT_TYPE) {
          // Likewise a transcript; one created since the last save has no file.
          if (chats[item.id]?.saved !== null && !deletedChats.includes(item.id)) deletedChats.push(item.id);
          delete chats[item.id];
        }
        deletedAssets = withAsset(deletedAssets, item.asset);
      }
      const items = state.tree.items
        .filter(i => !removed.has(i.id))
        .map(i => (i.references?.some(r => removed.has(r.targetId))
          ? { ...i, references: i.references.filter(r => !removed.has(r.targetId)) }
          : i));
      const bible = removedEntities.size ? removeEntities(state.bible, removedEntities) : state.bible;
      return { ...state, tree: { ...state.tree, items }, bible, docs, deletedDocs, chats, deletedChats, deletedAssets };
    }

    case 'bibleUpdated': {
      const bible = action.update(state.bible);
      return bible === state.bible ? state : { ...state, bible };
    }

    case 'extractionUpdated': {
      const extraction = action.update(state.extraction);
      return extraction === state.extraction ? state : { ...state, extraction };
    }

    case 'canonUpdated': {
      const next = action.update({ bible: state.bible, extraction: state.extraction });
      if (next.bible === state.bible && next.extraction === state.extraction) return state;
      return { ...state, bible: next.bible, extraction: next.extraction };
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
      // The written object becomes `saved` (the file no longer has a problem); a reply
      // that went on streaming after the payload was built still differs, so stays dirty.
      const chats = { ...state.chats };
      for (const [id, transcript] of Object.entries(payload.chats ?? {})) {
        if (transcript !== null && chats[id]) chats[id] = { saved: transcript, current: chats[id].current };
      }
      // The saved bible had its orphans pruned; adopt it when that's what is still in memory.
      let { bible } = state;
      if (payload.bible) {
        const pruned = pruneOrphans(state.bible, state.tree.items);
        if (pruned === payload.bible || JSON.stringify(pruned) === JSON.stringify(payload.bible)) bible = payload.bible;
      }
      let { extraction } = state;
      if (payload.extraction) {
        const pruned = pruneExtraction(state.extraction, state.tree.items, pruneOrphans(state.bible, state.tree.items));
        if (pruned === payload.extraction || JSON.stringify(pruned) === JSON.stringify(payload.extraction)) extraction = payload.extraction;
      }
      return {
        ...state,
        manifest: { ...action.manifest, name: state.manifest.name },
        savedName: payload.manifest?.name ?? state.savedName,
        savedTree: payload.tree ?? state.savedTree,
        bible,
        savedBible: payload.bible ?? state.savedBible,
        extraction,
        savedExtraction: payload.extraction ?? state.savedExtraction,
        docs,
        deletedDocs: state.deletedDocs.filter(id => payload.docs?.[id] !== null),
        chats,
        deletedChats: state.deletedChats.filter(id => payload.chats?.[id] !== null),
        deletedAssets: state.deletedAssets.filter(name => !payload.deletedAssets?.includes(name)),
      };
    }

    case 'recoveryRestored': {
      const { snapshot, diskDocs, diskChats } = action;
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
      const chats = { ...state.chats };
      const deletedChats = [...state.deletedChats];
      for (const [id, transcript] of Object.entries(snapshot.chats ?? {})) {
        if (transcript === null) {
          delete chats[id];
          if (!deletedChats.includes(id)) deletedChats.push(id);
        } else {
          chats[id] = { saved: diskChats[id] ?? null, current: normalizeTranscript(transcript) };
        }
      }
      return {
        ...state,
        manifest: snapshot.manifest ? { ...state.manifest, name: snapshot.manifest.name } : state.manifest,
        tree: snapshot.tree ?? state.tree,
        bible: snapshot.bible ?? state.bible,
        extraction: snapshot.extraction ?? state.extraction,
        docs,
        deletedDocs,
        chats,
        deletedChats,
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

    case 'structureKeptMine':
      // The disk copy changed under unsaved work. Mark every structure part
      // unsaved (fresh sentinels never equal the current values) so the next
      // save writes the user's whole structure, not just the part that was dirty.
      return {
        ...state, savedName: ' ', savedTree: { items: [] }, savedBible: { facts: [], dependencies: [], decisions: [] },
        savedExtraction: emptyExtraction(),
      };

    case 'structureReloaded': {
      const extraction = action.extraction ?? emptyExtraction();
      const ids = new Set(action.tree.items.map(i => i.id));
      const docs = Object.fromEntries(Object.entries(state.docs).filter(([id]) => ids.has(id)));
      const chats = Object.fromEntries(Object.entries(state.chats).filter(([id]) => ids.has(id)));
      return {
        ...state,
        manifest: action.manifest,
        savedName: action.manifest.name,
        tree: action.tree,
        savedTree: action.tree,
        bible: action.bible,
        savedBible: action.bible,
        extraction,
        savedExtraction: extraction,
        docs,
        deletedDocs: [],
        chats,
        deletedChats: [],
        deletedAssets: [],
      };
    }
  }
}

export const isDocDirty = (state: ProjectState, id: string) => {
  const doc = state.docs[id];
  return !!doc && doc.current !== doc.saved;
};

export const isChatDirty = (state: ProjectState, id: string) => {
  const chat = state.chats[id];
  return !!chat && chat.current !== chat.saved;
};

export const isStructureDirty = (state: ProjectState) =>
  state.manifest.name !== state.savedName || state.tree !== state.savedTree || state.bible !== state.savedBible
  || state.extraction !== state.savedExtraction || state.deletedDocs.length > 0;

export const isDirty = (state: ProjectState | null) =>
  !!state && (
    isStructureDirty(state)
    || Object.keys(state.docs).some(id => isDocDirty(state, id))
    || state.deletedChats.length > 0
    || Object.keys(state.chats).some(id => isChatDirty(state, id))
  );

/** Everything unsaved, in the shape project:save (and recovery snapshots) accept. */
export function buildSavePayload(state: ProjectState): SavePayload {
  const payload: SavePayload = {};
  if (state.manifest.name !== state.savedName) payload.manifest = { name: state.manifest.name };
  if (state.tree !== state.savedTree) payload.tree = state.tree;
  // Facts about missing entities are tolerated on load and dropped here.
  const bible = pruneOrphans(state.bible, state.tree.items);
  if (state.bible !== state.savedBible || bible !== state.bible) payload.bible = bible;
  const extraction = pruneExtraction(state.extraction, state.tree.items, bible);
  if (state.extraction !== state.savedExtraction || extraction !== state.extraction) payload.extraction = extraction;

  const docs: Record<string, string | null> = {};
  for (const [id, doc] of Object.entries(state.docs)) {
    if (doc.current !== doc.saved) docs[id] = doc.current;
  }
  for (const id of state.deletedDocs) docs[id] = null;
  if (Object.keys(docs).length) payload.docs = docs;

  // A reply still streaming is written as cancelled; its completion makes the chat dirty again.
  const chats: Record<string, ChatTranscript | null> = {};
  for (const [id, chat] of Object.entries(state.chats)) {
    if (chat.current !== chat.saved) chats[id] = forPersistence(chat.current);
  }
  for (const id of state.deletedChats) chats[id] = null;
  if (Object.keys(chats).length) payload.chats = chats;

  if (state.deletedAssets.length) payload.deletedAssets = state.deletedAssets;
  return payload;
}
