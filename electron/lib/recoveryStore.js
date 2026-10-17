import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { atomicWriteFile } from './atomicFileWrite.js';
import { validateSavePayload } from './projectSchema.js';
import { rootKey } from './recentProjects.js';

/**
 * Crash-recovery snapshots of unsaved work, one file per project, kept in
 * userData rather than the project folder so a crash never leaves stray files
 * in the user's (possibly cloud-synced or git-tracked) project. A snapshot has
 * the same shape as a save request and is cleared once the project is saved.
 */
export function createRecoveryStore(dir, { now = () => new Date().toISOString() } = {}) {
    const fileFor = (root) =>
        path.join(dir, `${crypto.createHash('sha256').update(rootKey(root)).digest('hex').slice(0, 32)}.json`);

    return {
        async write(root, snapshot) {
            const valid = validateSavePayload(snapshot);
            await fs.mkdir(dir, { recursive: true });
            await atomicWriteFile(fileFor(root), JSON.stringify({ root: path.resolve(root), savedAt: now(), ...valid }));
        },

        async read(root) {
            let stored;
            try {
                stored = JSON.parse(await fs.readFile(fileFor(root), 'utf-8'));
            } catch {
                return null;
            }
            if (typeof stored?.root !== 'string' || rootKey(stored.root) !== rootKey(root)) return null;
            const { root: _root, savedAt, ...snapshot } = stored;
            try {
                return { savedAt, ...validateSavePayload(snapshot) };
            } catch {
                return null;
            }
        },

        async clear(root) {
            await fs.rm(fileFor(root), { force: true });
        },
    };
}
