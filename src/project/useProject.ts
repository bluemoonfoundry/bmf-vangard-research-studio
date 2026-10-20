import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import {
  AI_CHAT_TYPE, buildSavePayload, isChatDirty, isDirty, isDocDirty, isStructureDirty, projectReducer,
  type ChatDefaults, type ProjectState,
} from '@/project/projectState';
import type { ProjectApi } from '@/project/api';
import type { Bible, ExternalChange, MediaKind, OpenedProject, RecentProject, RecoverySnapshot, TreeItem } from '@/project/types';
import { forPersistence, newTranscript, normalizeTranscript } from '@/chat/transcript';
import type { ChatTranscript } from '@/chat/types';
import type { Canon, ExtractionState } from '@/extraction/types';
import { createAssetCache } from '@/workspace/assetCache';
import { descendantIds, duplicateSubtree, nextOrder, type DropPosition } from '@/workspace/treeOps';

/** Delay between the last edit and writing a crash-recovery snapshot. */
export const RECOVERY_DEBOUNCE_MS = 1000;

/** Marker in `conflicts` for tree.json / vrs.json changing on disk while the structure has unsaved edits. */
export const STRUCTURE_CONFLICT = 'structure';

/** Files reloaded (or flagged) as one structure. */
const STRUCTURE_FILES = ['tree.json', 'vrs.json', 'bible/bible.json', 'bible/extraction.json'];

const DOC_PATH = /^docs\/([A-Za-z0-9_-]+)\.md$/;
const CHAT_PATH = /^chats\/([A-Za-z0-9_-]+)\.json$/;
const ASSET_PATH = /^assets\/([^/]+)$/;

const NO_CHAT_DEFAULTS: ChatDefaults = { provider: null, model: null };

/** Fields a caller supplies for a new binder item; the rest are filled in. */
export type NewItem = Partial<TreeItem> & Pick<TreeItem, 'type' | 'title'>;

export interface UseProjectOptions {
  /** Provider and model for chats that have no transcript yet (read when one is needed). */
  chatDefaults?: () => ChatDefaults;
}

function describeError(err: unknown) {
  return err instanceof Error ? err.message : String(err);
}

export function useProject(
  api: ProjectApi | null,
  bridge: Pick<VrsApi['app'], 'onSaveBeforeClose' | 'closeConfirmed'> | null,
  options: UseProjectOptions = {},
) {
  const [state, dispatch] = useReducer(projectReducer, null);
  const chatDefaultsRef = useRef(options.chatDefaults);
  chatDefaultsRef.current = options.chatDefaults;
  const chatDefaults = useCallback(() => chatDefaultsRef.current?.() ?? NO_CHAT_DEFAULTS, []);
  const [recents, setRecents] = useState<RecentProject[]>([]);
  const [recovery, setRecovery] = useState<RecoverySnapshot | null>(null);
  const [migratedFrom, setMigratedFrom] = useState<number | null>(null);
  /** Paths (or STRUCTURE_CONFLICT) changed on disk while they had unsaved edits here. */
  const [conflicts, setConflicts] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Async callbacks read the latest state through this ref rather than a stale closure.
  const stateRef = useRef<ProjectState | null>(state);
  stateRef.current = state;

  const dirty = isDirty(state);

  // vrs-asset: URLs for imported media, scoped to the open project.
  const root = state?.root ?? null;
  const assets = useMemo(() => (api && root ? createAssetCache(name => api.checkAsset(name)) : null), [api, root]);
  useEffect(() => () => assets?.clear(), [assets]);

  const run = useCallback(async <T,>(action: () => Promise<T>): Promise<T | undefined> => {
    try {
      setError(null);
      return await action();
    } catch (err) {
      setError(describeError(err));
      return undefined;
    }
  }, []);

  const refreshRecents = useCallback(async () => {
    if (!api) return;
    const list = await run(() => api.listRecent());
    if (list) setRecents(list);
  }, [api, run]);

  useEffect(() => {
    void refreshRecents();
  }, [refreshRecents]);

  const save = useCallback(async (): Promise<boolean> => {
    const current = stateRef.current;
    if (!api || !current) return false;
    const payload = buildSavePayload(current);
    setSaving(true);
    try {
      setError(null);
      const { manifest } = await api.save(payload);
      dispatch({ type: 'saved', payload, manifest });
      return true;
    } catch (err) {
      setError(`Could not save: ${describeError(err)}`);
      return false;
    } finally {
      setSaving(false);
    }
  }, [api]);

  /** Resolves true when it's fine to leave the current project (saved, discarded, or clean). */
  const confirmLeave = useCallback(async (): Promise<'clean' | 'saved' | 'discard' | false> => {
    if (!api || !isDirty(stateRef.current)) return 'clean';
    const choice = await api.confirmUnsaved();
    if (choice === 'cancel') return false;
    if (choice === 'discard') return 'discard';
    return (await save()) ? 'saved' : false;
  }, [api, save]);

  const adopt = useCallback((project: OpenedProject | null | undefined) => {
    if (!project) return;
    dispatch({ type: 'opened', project });
    setRecovery(project.recovery);
    setMigratedFrom(project.migratedFrom);
    setConflicts([]);
    void refreshRecents();
  }, [refreshRecents]);

  const switchTo = useCallback(async (openNext: () => Promise<OpenedProject | null>) => {
    if (!api) return;
    const leave = await confirmLeave();
    if (!leave) return;
    // Recovery calls act on the project the main process has open, so drop the
    // old project's snapshot before switching -- and put it back if we don't switch.
    if (leave === 'discard') await run(() => api.discardRecovery());
    const next = await run(openNext);
    const current = stateRef.current;
    if (!next && leave === 'discard' && current) await run(() => api.writeRecovery(buildSavePayload(current)));
    adopt(next);
  }, [api, adopt, confirmLeave, run]);

  const createProject = useCallback(() => switchTo(() => api!.create()), [api, switchTo]);
  const openProject = useCallback(() => switchTo(() => api!.open()), [api, switchTo]);
  const openRecent = useCallback((root: string) => switchTo(() => api!.openRecent(root)), [api, switchTo]);

  const removeRecent = useCallback(async (root: string) => {
    if (!api) return;
    await run(() => api.removeRecent(root));
    await refreshRecents();
  }, [api, refreshRecents, run]);

  const closeProject = useCallback(async () => {
    if (!api) return;
    const leave = await confirmLeave();
    if (!leave) return;
    await run(() => api.close({ discardRecovery: leave === 'discard' }));
    dispatch({ type: 'closed' });
    setRecovery(null);
    setConflicts([]);
    void refreshRecents();
  }, [api, confirmLeave, refreshRecents, run]);

  const loadDoc = useCallback(async (id: string) => {
    if (!api || stateRef.current?.docs[id]) return;
    const content = await run(() => api.readDoc(id));
    if (content !== undefined) dispatch({ type: 'docLoaded', id, content });
  }, [api, run]);

  /** Reads every document body not loaded yet (search, word counts and export need them all). */
  const loadAllDocs = useCallback(async () => {
    const current = stateRef.current;
    if (!api || !current) return;
    const ids = current.tree.items.map(i => i.id).filter(id => !current.docs[id]);
    if (!ids.length) return;
    const bodies = await run(() => Promise.all(ids.map(id => api.readDoc(id))));
    if (bodies) dispatch({ type: 'docsLoaded', docs: Object.fromEntries(ids.map((id, i) => [id, bodies[i]])) });
  }, [api, run]);

  /** Reads chats/<id>.json; a missing or damaged file is an empty chat (with the problem, for a notice). */
  const readTranscript = useCallback(async (id: string) => {
    const { transcript, problem } = await api!.readChat(id);
    return { transcript: transcript ? normalizeTranscript(transcript) : null, problem };
  }, [api]);

  /** Reads every AI chat transcript not loaded yet. */
  const loadAllChats = useCallback(async () => {
    const current = stateRef.current;
    if (!api || !current) return;
    const ids = current.tree.items.filter(i => i.type === AI_CHAT_TYPE && !current.chats[i.id]).map(i => i.id);
    if (!ids.length) return;
    // Settled one by one: a chat that fails to load carries the reason (and opens read-only) instead of blocking the rest.
    const read = await Promise.allSettled(ids.map(readTranscript));
    const chats = Object.fromEntries(ids.map((id, i) => {
      const r = read[i];
      return [id, r.status === 'fulfilled' ? r.value : { transcript: null, problem: describeError(r.reason) }];
    }));
    dispatch({ type: 'chatsLoaded', defaults: chatDefaults(), chats });
  }, [api, chatDefaults, readTranscript]);

  // Transcripts load with the project (search needs them), and again for chats that appear in the tree.
  const items = state?.tree.items;
  useEffect(() => {
    if (items?.some(i => i.type === AI_CHAT_TYPE && !stateRef.current?.chats[i.id])) void loadAllChats();
  }, [items, loadAllChats]);

  const updateChat = useCallback((id: string, update: (t: ChatTranscript) => ChatTranscript) =>
    dispatch({ type: 'chatUpdated', id, update }), []);

  /** Adds a binder item (at the end of its parent) with an optional body (and transcript, for an AI chat); returns its id. */
  const addItem = useCallback((fields: NewItem, content = '', chat?: ChatTranscript): string => {
    const items = stateRef.current?.tree.items ?? [];
    const now = new Date().toISOString();
    const parentId = fields.parentId ?? null;
    const item: TreeItem = {
      keywords: [],
      ...fields,
      id: crypto.randomUUID(),
      parentId,
      order: nextOrder(items, parentId),
      createdAt: now,
      updatedAt: now,
    };
    const chats = item.type === AI_CHAT_TYPE ? { [item.id]: chat ?? newTranscript(chatDefaults()) } : undefined;
    dispatch({ type: 'itemsAdded', items: [item], docs: { [item.id]: content }, chats });
    return item.id;
  }, [chatDefaults]);

  const addDocument = useCallback((title: string) => addItem({ type: 'document', title }), [addItem]);

  const updateItem = useCallback((id: string, patch: Partial<TreeItem>) =>
    dispatch({ type: 'itemUpdated', id, patch: { ...patch, updatedAt: new Date().toISOString() } }), []);

  const moveItem = useCallback((id: string, targetId: string | null, position: DropPosition) =>
    dispatch({ type: 'itemMoved', id, targetId, position }), []);

  /** Copies an item and everything under it, bodies and chat transcripts included; resolves to the copy's id. */
  const duplicateItem = useCallback(async (id: string): Promise<string | null> => {
    const current = stateRef.current;
    if (!api || !current) return null;
    const subtree = [...descendantIds(current.tree.items, id)];
    const chatIds = current.tree.items.filter(i => i.type === AI_CHAT_TYPE && subtree.includes(i.id)).map(i => i.id);
    const read = await run(() => Promise.all([
      Promise.all(subtree.map(i => current.docs[i]?.current ?? api.readDoc(i))),
      // A reply still streaming is copied as cancelled: only the original receives the rest.
      Promise.all(chatIds.map(async i => forPersistence(
        current.chats[i]?.current ?? (await readTranscript(i)).transcript ?? newTranscript(chatDefaults()),
      ))),
    ]));
    const latest = stateRef.current;
    if (!read || !latest?.tree.items.some(i => i.id === id)) return null;
    const [bodies, transcripts] = read;
    const { added, idMap } = duplicateSubtree(latest.tree.items, id, () => crypto.randomUUID(), new Date().toISOString());
    const docs = Object.fromEntries(subtree.map((oldId, i) => [idMap.get(oldId)!, bodies[i]]));
    const chats = Object.fromEntries(chatIds.map((oldId, i) => [idMap.get(oldId)!, transcripts[i]]));
    dispatch({ type: 'itemsAdded', items: added, docs, chats });
    return idMap.get(id) ?? null;
  }, [api, chatDefaults, readTranscript, run]);

  /** Marks an asset file as unwanted; it's deleted on the next save unless something still uses it. */
  const discardAsset = useCallback((asset: string) => dispatch({ type: 'assetDiscarded', asset }), []);

  /** Lets the user pick a media file and copies it into the project; null if they cancel. */
  const importMedia = useCallback(async (kind: MediaKind) => {
    if (!api) return null;
    return (await run(() => api.importMedia(kind))) ?? null;
  }, [api, run]);

  /**
   * Imports a media file as a new item beside an entity and links it to the entity's card.
   * Returns the new item's id; null if the user cancels or the entity is gone by then.
   */
  const importMediaOnto = useCallback(async (entityId: string, kind: MediaKind) => {
    const picked = await importMedia(kind);
    if (!picked) return null;
    // Read the entity after the dialog closes, so references added meanwhile aren't lost.
    const entity = stateRef.current?.tree.items.find(i => i.id === entityId);
    if (!entity) {
      discardAsset(picked.asset);
      return null;
    }
    const id = addItem({ type: kind, title: picked.originalName, parentId: entity.parentId, asset: picked.asset });
    updateItem(entityId, { references: [...(entity.references ?? []), { id: crypto.randomUUID(), targetId: id }] });
    return id;
  }, [importMedia, discardAsset, addItem, updateItem]);

  /** Lets the user pick text files to import; null if they cancel or it fails. */
  const importTexts = useCallback(async () => {
    if (!api) return null;
    return (await run(() => api.importTexts())) ?? null;
  }, [api, run]);

  const updateBible = useCallback((update: (b: Bible) => Bible) => dispatch({ type: 'bibleUpdated', update }), []);
  const updateExtraction = useCallback(
    (update: (x: ExtractionState) => ExtractionState) => dispatch({ type: 'extractionUpdated', update }), []);
  /** Changes the bible and the extraction state together (extraction runs and review). */
  const updateCanon = useCallback((update: (c: Canon) => Canon) => dispatch({ type: 'canonUpdated', update }), []);

  /** Saves Markdown to a file the user picks; resolves to its path, or null if cancelled or failed. */
  const exportDossier = useCallback(async (markdown: string) => {
    if (!api) return null;
    return (await run(() => api.exportDossier(markdown))) ?? null;
  }, [api, run]);

  const editDoc = useCallback((id: string, content: string) => dispatch({ type: 'docEdited', id, content }), []);
  const renameItem = useCallback((id: string, title: string) => dispatch({ type: 'itemRenamed', id, title }), []);
  const deleteItem = useCallback((id: string) => dispatch({ type: 'itemDeleted', id }), []);
  const renameProject = useCallback((name: string) => dispatch({ type: 'projectRenamed', name }), []);

  const restoreRecovery = useCallback(async () => {
    if (!api || !recovery) return;
    const diskDocs: Record<string, string> = {};
    const diskChats: Record<string, ChatTranscript> = {};
    const restored = await run(async () => {
      for (const [id, body] of Object.entries(recovery.docs ?? {})) {
        if (body !== null) diskDocs[id] = await api.readDoc(id);
      }
      for (const [id, transcript] of Object.entries(recovery.chats ?? {})) {
        if (transcript === null) continue;
        const disk = (await readTranscript(id)).transcript;
        if (disk) diskChats[id] = disk;
      }
      return true;
    });
    if (!restored) return;
    dispatch({ type: 'recoveryRestored', snapshot: recovery, diskDocs, diskChats });
    setRecovery(null);
  }, [api, readTranscript, recovery, run]);

  const discardRecovery = useCallback(async () => {
    if (!api) return;
    await run(() => api.discardRecovery());
    setRecovery(null);
  }, [api, run]);

  /** The chat as disk has it now; a missing or damaged file reads as an empty chat. */
  const readDiskChat = useCallback(async (id: string) => {
    const { transcript, problem } = await readTranscript(id);
    return { transcript: transcript ?? newTranscript(chatDefaults()), problem };
  }, [chatDefaults, readTranscript]);

  const reloadFromDisk = useCallback(async (conflict: string) => {
    if (!api) return;
    const doc = DOC_PATH.exec(conflict);
    const chat = CHAT_PATH.exec(conflict);
    if (doc) {
      const content = await run(() => api.readDoc(doc[1]));
      if (content !== undefined) dispatch({ type: 'docReloaded', id: doc[1], content });
    } else if (chat) {
      const disk = await run(() => readDiskChat(chat[1]));
      if (disk) dispatch({ type: 'chatReloaded', id: chat[1], ...disk });
    } else {
      const structure = await run(() => api.readStructure());
      if (structure) dispatch({ type: 'structureReloaded', ...structure });
    }
    setConflicts(c => c.filter(p => p !== conflict));
  }, [api, readDiskChat, run]);

  const keepMine = useCallback(async (conflict: string) => {
    if (!api) return;
    const doc = DOC_PATH.exec(conflict);
    const chat = CHAT_PATH.exec(conflict);
    if (doc) {
      // Rebase on the new disk content so "dirty" still means "differs from disk".
      const content = await run(() => api.readDoc(doc[1]));
      if (content !== undefined) dispatch({ type: 'docDiskChanged', id: doc[1], content });
    } else if (chat) {
      const disk = await run(() => readDiskChat(chat[1]));
      if (disk) dispatch({ type: 'chatDiskChanged', id: chat[1], transcript: disk.transcript });
    } else {
      // Disk has changed under us: write all of my structure, not just the dirty part.
      dispatch({ type: 'structureKeptMine' });
    }
    setConflicts(c => c.filter(p => p !== conflict));
  }, [api, readDiskChat, run]);

  // External edits: reload what's clean, flag what would overwrite unsaved work.
  useEffect(() => {
    if (!api) return;
    return api.onExternalChange((changes: ExternalChange[]) => {
      void (async () => {
        for (const change of changes) {
          const current = stateRef.current;
          if (!current) return;
          const asset = ASSET_PATH.exec(change.path);
          if (asset) {
            assets?.invalidate(asset[1]);
            continue;
          }
          const doc = DOC_PATH.exec(change.path);
          const chat = CHAT_PATH.exec(change.path);
          if (doc) {
            const id = doc[1];
            if (!current.docs[id]) continue; // not loaded: the next read gets the new content
            if (isDocDirty(current, id)) {
              setConflicts(c => (c.includes(change.path) ? c : [...c, change.path]));
            } else {
              const content = change.deleted ? '' : await run(() => api.readDoc(id));
              if (content !== undefined) dispatch({ type: 'docReloaded', id, content });
            }
          } else if (chat) {
            const id = chat[1];
            if (!current.chats[id]) continue; // not loaded: the pending read gets the new content
            if (isChatDirty(current, id)) {
              setConflicts(c => (c.includes(change.path) ? c : [...c, change.path]));
            } else {
              const disk = change.deleted
                ? { transcript: newTranscript(chatDefaults()), problem: null }
                : await run(() => readDiskChat(id));
              if (disk) dispatch({ type: 'chatReloaded', id, ...disk });
            }
          } else if (STRUCTURE_FILES.includes(change.path)) {
            if (isStructureDirty(current)) {
              setConflicts(c => (c.includes(STRUCTURE_CONFLICT) ? c : [...c, STRUCTURE_CONFLICT]));
            } else {
              const structure = await run(() => api.readStructure());
              if (structure) dispatch({ type: 'structureReloaded', ...structure });
            }
          }
        }
      })();
    });
  }, [api, assets, chatDefaults, readDiskChat, run]);

  // Let the main process know, so closing the window can prompt to save.
  const hasProject = state !== null;
  useEffect(() => {
    if (api && hasProject) void api.setDirty(dirty).catch(() => {});
  }, [api, dirty, hasProject]);

  // Crash-recovery snapshot of unsaved work, written shortly after edits stop.
  useEffect(() => {
    if (!api || !state || !dirty) return;
    const timer = setTimeout(() => {
      void api.writeRecovery(buildSavePayload(state)).catch(() => {});
    }, RECOVERY_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [api, dirty, state]);

  // The window is closing and the user chose "Save".
  useEffect(() => {
    if (!bridge) return;
    return bridge.onSaveBeforeClose(() => {
      void save().then(ok => {
        if (ok) void bridge.closeConfirmed();
      });
    });
  }, [bridge, save]);

  const reportError = useCallback((message: string) => setError(message), []);

  return useMemo(() => ({
    state, dirty, saving, error, recents, recovery, migratedFrom, conflicts, assets,
    createProject, openProject, openRecent, removeRecent, closeProject, save,
    loadDoc, loadAllDocs, loadAllChats, updateChat, addDocument, addItem, updateItem, moveItem, duplicateItem, editDoc, renameItem, deleteItem,
    renameProject, discardAsset, importMedia, importMediaOnto, importTexts, updateBible, updateExtraction, updateCanon, exportDossier,
    restoreRecovery, discardRecovery, reloadFromDisk, keepMine, reportError,
    dismissError: () => setError(null),
    dismissMigration: () => setMigratedFrom(null),
  }), [
    state, dirty, saving, error, recents, recovery, migratedFrom, conflicts, assets,
    createProject, openProject, openRecent, removeRecent, closeProject, save,
    loadDoc, loadAllDocs, loadAllChats, updateChat, addDocument, addItem, updateItem, moveItem, duplicateItem, editDoc, renameItem, deleteItem,
    renameProject, discardAsset, importMedia, importMediaOnto, importTexts, updateBible, updateExtraction, updateCanon, exportDossier,
    restoreRecovery, discardRecovery, reloadFromDisk, keepMine, reportError,
  ]);
}

export type ProjectController = ReturnType<typeof useProject>;
