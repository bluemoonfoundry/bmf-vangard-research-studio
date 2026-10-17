import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { buildSavePayload, isDirty, isDocDirty, isStructureDirty, projectReducer, type ProjectState } from '@/project/projectState';
import type { ProjectApi } from '@/project/api';
import type { ExternalChange, OpenedProject, RecentProject, RecoverySnapshot, TreeItem } from '@/project/types';

/** Delay between the last edit and writing a crash-recovery snapshot. */
export const RECOVERY_DEBOUNCE_MS = 1000;

/** Marker in `conflicts` for tree.json / vrs.json changing on disk while the structure has unsaved edits. */
export const STRUCTURE_CONFLICT = 'structure';

const DOC_PATH = /^docs\/([A-Za-z0-9_-]+)\.md$/;

function describeError(err: unknown) {
  return err instanceof Error ? err.message : String(err);
}

export function useProject(api: ProjectApi | null, bridge: Pick<VrsApi['app'], 'onSaveBeforeClose' | 'closeConfirmed'> | null) {
  const [state, dispatch] = useReducer(projectReducer, null);
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

  const addDocument = useCallback((title: string): string => {
    const items = stateRef.current?.tree.items ?? [];
    const now = new Date().toISOString();
    const item: TreeItem = {
      id: crypto.randomUUID(),
      parentId: null,
      type: 'document',
      title,
      order: items.reduce((max, i) => Math.max(max, i.order + 1), 0),
      keywords: [],
      createdAt: now,
      updatedAt: now,
    };
    dispatch({ type: 'docAdded', item });
    return item.id;
  }, []);

  const editDoc = useCallback((id: string, content: string) => dispatch({ type: 'docEdited', id, content }), []);
  const renameItem = useCallback((id: string, title: string) => dispatch({ type: 'itemRenamed', id, title }), []);
  const deleteItem = useCallback((id: string) => dispatch({ type: 'itemDeleted', id }), []);
  const renameProject = useCallback((name: string) => dispatch({ type: 'projectRenamed', name }), []);

  const restoreRecovery = useCallback(async () => {
    if (!api || !recovery) return;
    const diskDocs: Record<string, string> = {};
    const restored = await run(async () => {
      for (const [id, body] of Object.entries(recovery.docs ?? {})) {
        if (body !== null) diskDocs[id] = await api.readDoc(id);
      }
      return true;
    });
    if (!restored) return;
    dispatch({ type: 'recoveryRestored', snapshot: recovery, diskDocs });
    setRecovery(null);
  }, [api, recovery, run]);

  const discardRecovery = useCallback(async () => {
    if (!api) return;
    await run(() => api.discardRecovery());
    setRecovery(null);
  }, [api, run]);

  const reloadFromDisk = useCallback(async (conflict: string) => {
    if (!api) return;
    const doc = DOC_PATH.exec(conflict);
    if (doc) {
      const content = await run(() => api.readDoc(doc[1]));
      if (content !== undefined) dispatch({ type: 'docReloaded', id: doc[1], content });
    } else {
      const structure = await run(() => api.readStructure());
      if (structure) dispatch({ type: 'structureReloaded', ...structure });
    }
    setConflicts(c => c.filter(p => p !== conflict));
  }, [api, run]);

  const keepMine = useCallback(async (conflict: string) => {
    if (!api) return;
    const doc = DOC_PATH.exec(conflict);
    if (doc) {
      // Rebase on the new disk content so "dirty" still means "differs from disk".
      const content = await run(() => api.readDoc(doc[1]));
      if (content !== undefined) dispatch({ type: 'docDiskChanged', id: doc[1], content });
    }
    setConflicts(c => c.filter(p => p !== conflict));
  }, [api, run]);

  // External edits: reload what's clean, flag what would overwrite unsaved work.
  useEffect(() => {
    if (!api) return;
    return api.onExternalChange((changes: ExternalChange[]) => {
      void (async () => {
        for (const change of changes) {
          const current = stateRef.current;
          if (!current) return;
          const doc = DOC_PATH.exec(change.path);
          if (doc) {
            const id = doc[1];
            if (!current.docs[id]) continue; // not loaded: the next read gets the new content
            if (isDocDirty(current, id)) {
              setConflicts(c => (c.includes(change.path) ? c : [...c, change.path]));
            } else {
              const content = change.deleted ? '' : await run(() => api.readDoc(id));
              if (content !== undefined) dispatch({ type: 'docReloaded', id, content });
            }
          } else if (change.path === 'tree.json' || change.path === 'vrs.json') {
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
  }, [api, run]);

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

  return useMemo(() => ({
    state, dirty, saving, error, recents, recovery, migratedFrom, conflicts,
    createProject, openProject, openRecent, removeRecent, closeProject, save,
    loadDoc, addDocument, editDoc, renameItem, deleteItem, renameProject,
    restoreRecovery, discardRecovery, reloadFromDisk, keepMine,
    dismissError: () => setError(null),
    dismissMigration: () => setMigratedFrom(null),
  }), [
    state, dirty, saving, error, recents, recovery, migratedFrom, conflicts,
    createProject, openProject, openRecent, removeRecent, closeProject, save,
    loadDoc, addDocument, editDoc, renameItem, deleteItem, renameProject,
    restoreRecovery, discardRecovery, reloadFromDisk, keepMine,
  ]);
}

export type ProjectController = ReturnType<typeof useProject>;
