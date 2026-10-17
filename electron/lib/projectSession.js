import path from 'path';
import crypto from 'crypto';
import { ProjectFormatError } from './projectSchema.js';
import { createProject, importAsset, openProject, readAsset, readDoc, readStructure, saveProject } from './projectStore.js';
import { readTextImport } from './textImport.js';
import { createProjectWatcher } from './projectWatcher.js';

const PROJECT_EXTENSION = '.vrs';

/**
 * The open project, as seen by the IPC handlers.
 *
 * This is where "vetted roots" are enforced: the session's root can only be set
 * from a path the user picked in a native dialog (create/open), or from an
 * entry in the recent list (openRecent), which itself only ever contains
 * dialog-picked roots. The renderer never supplies an arbitrary root, and
 * every other operation works inside the current root.
 *
 * @param {{
 *   recents: ReturnType<typeof import('./recentProjects.js').createRecentProjects>,
 *   recovery: ReturnType<typeof import('./recoveryStore.js').createRecoveryStore>,
 *   onExternalChange: (changes: { path: string, deleted: boolean }[]) => void,
 *   now?: () => string,
 *   newId?: () => string,
 *   watcherFactory?: (root: string, options: { onChange: (changes: any) => void, onError: (err: unknown) => void })
 *     => { noteWrite: (relPath: string, content: string | null) => void, close: () => void },
 *   onWatchError?: (err: unknown) => void,
 * }} options
 */
export function createProjectSession({
    recents,
    recovery,
    onExternalChange,
    now = () => new Date().toISOString(),
    newId = () => crypto.randomUUID(),
    watcherFactory = createProjectWatcher,
    onWatchError = () => {},
}) {
    let current = null; // { root, watcher }

    function requireRoot() {
        if (!current) throw new ProjectFormatError('NO_PROJECT', 'No project is open.');
        return current.root;
    }

    async function activate(root, opened) {
        current?.watcher.close();
        const watcher = watcherFactory(root, { onChange: onExternalChange, onError: onWatchError });
        current = { root, watcher };
        await recents.add({ root, name: opened.manifest.name });
        return { root, ...opened, recovery: await recovery.read(root) };
    }

    return {
        get root() {
            return current?.root ?? null;
        },

        /** `root` must come from the save dialog. */
        async create(root) {
            const name = path.basename(root, PROJECT_EXTENSION) || 'Untitled';
            const created = await createProject(root, { id: newId(), name, now: now() });
            return activate(root, { ...created, migratedFrom: null });
        },

        /** `root` must come from the open dialog. Opening fails without touching the current project. */
        async open(root) {
            const opened = await openProject(root);
            return activate(root, opened);
        },

        async openRecent(root) {
            const entry = await recents.find(root);
            if (!entry) throw new ProjectFormatError('NOT_RECENT', 'That project is not in the recent list.');
            return this.open(entry.root);
        },

        async close({ discardRecovery = false } = {}) {
            if (!current) return;
            if (discardRecovery) await recovery.clear(current.root);
            current.watcher.close();
            current = null;
        },

        async readDoc(id) {
            return readDoc(requireRoot(), id);
        },

        async readAsset(name) {
            return readAsset(requireRoot(), name);
        },

        /** `sourcePath` must come from the open dialog; the destination is always inside the session root. */
        async importAsset(sourcePath, kind) {
            return importAsset(requireRoot(), sourcePath, { kind, newId: newId() });
        },

        /** Reads a transcript picked in the open dialog; refuses unless a project is open. */
        async readTextImport(sourcePath) {
            requireRoot();
            return readTextImport(sourcePath);
        },

        async readStructure() {
            return readStructure(requireRoot());
        },

        async save(payload) {
            const root = requireRoot();
            const { watcher } = current;
            const result = await saveProject(root, payload, {
                now: now(),
                onWrite: (relPath, content) => watcher.noteWrite(relPath, content),
            });
            await recovery.clear(root);
            if (payload?.manifest) await recents.add({ root, name: result.manifest.name });
            return result;
        },

        async writeRecovery(snapshot) {
            await recovery.write(requireRoot(), snapshot);
        },

        async discardRecovery() {
            await recovery.clear(requireRoot());
        },
    };
}

/** Runs an IPC handler body and returns a structured-clone-safe `{ ok, value | error }` envelope. */
export async function toIpcResult(fn) {
    try {
        return { ok: true, value: await fn() };
    } catch (err) {
        const code = typeof err?.code === 'string' && /^[A-Z_]+$/.test(err.code) ? err.code : 'IO';
        return { ok: false, error: { code, message: err?.message ?? String(err) } };
    }
}
