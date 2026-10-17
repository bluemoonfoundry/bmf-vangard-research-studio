import fs from 'fs/promises';
import path from 'path';
import { atomicWriteFile } from './atomicFileWrite.js';

/** Comparison key for a project root: resolved, and case-folded on Windows. */
export function rootKey(root) {
    const resolved = path.resolve(root);
    return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function isEntry(value) {
    return typeof value === 'object' && value !== null
        && typeof value.root === 'string' && typeof value.name === 'string' && typeof value.openedAt === 'string';
}

/**
 * The recent-projects list in userData. Entries are only ever added for roots
 * the user picked in a dialog, which is what lets `has()` vet a root the
 * renderer asks to reopen.
 */
export function createRecentProjects(filePath, { max = 10, now = () => new Date().toISOString() } = {}) {
    async function load() {
        try {
            const parsed = JSON.parse(await fs.readFile(filePath, 'utf-8'));
            return Array.isArray(parsed) ? parsed.filter(isEntry) : [];
        } catch {
            return [];
        }
    }

    async function store(entries) {
        await fs.mkdir(path.dirname(filePath), { recursive: true });
        await atomicWriteFile(filePath, `${JSON.stringify(entries, null, 2)}\n`);
    }

    async function exists(root) {
        try {
            return (await fs.stat(root)).isDirectory();
        } catch {
            return false;
        }
    }

    return {
        async list() {
            const entries = await load();
            return Promise.all(entries.map(async (e) => ({ ...e, missing: !(await exists(e.root)) })));
        },

        async add({ root, name }) {
            const key = rootKey(root);
            const rest = (await load()).filter(e => rootKey(e.root) !== key);
            await store([{ root: path.resolve(root), name, openedAt: now() }, ...rest].slice(0, max));
        },

        async remove(root) {
            const key = rootKey(root);
            await store((await load()).filter(e => rootKey(e.root) !== key));
        },

        async has(root) {
            if (typeof root !== 'string') return false;
            const key = rootKey(root);
            return (await load()).some(e => rootKey(e.root) === key);
        },

        /** The stored spelling of a root, so reopening uses the path the dialog returned. */
        async find(root) {
            if (typeof root !== 'string') return null;
            const key = rootKey(root);
            return (await load()).find(e => rootKey(e.root) === key) ?? null;
        },
    };
}
