import fs from 'fs';
import fsPromises from 'fs/promises';
import path from 'path';
import crypto from 'crypto';

const TEMP_FILE = /^\..+\.tmp-[0-9a-f-]+$/;

const hash = (content) => (content === null ? null : crypto.createHash('sha256').update(content).digest('hex'));

function isIgnored(relPath) {
    const segments = relPath.split('/');
    if (segments.some(s => s.startsWith('.'))) return true; // .git/, editor swap files, atomic temp files
    const base = segments[segments.length - 1];
    return TEMP_FILE.test(base) || base.endsWith('.bak');
}

/**
 * Watches a project folder for changes made outside VRS (another editor, git,
 * a sync client) and reports them in debounced batches.
 *
 * VRS's own saves also trigger fs.watch, and event timing varies by platform,
 * so instead of time-window suppression the watcher compares content: it
 * remembers the hash of every file it wrote (`noteWrite`) or already reported,
 * and only reports a path whose content now differs from that.
 *
 * @param {string} root
 * @param {{
 *   onChange: (changes: { path: string, deleted: boolean }[]) => void,
 *   onError?: (err: unknown) => void,
 *   debounceMs?: number,
 *   watchFn?: (root: string, options: { recursive: boolean }, listener: (eventType: string, filename: string | null) => void)
 *     => { close: () => void, on?: (event: string, listener: (err: unknown) => void) => unknown },
 *   readFileFn?: (fullPath: string) => Promise<string>,
 * }} options
 */
export function createProjectWatcher(root, {
    onChange,
    onError = () => {},
    debounceMs = 300,
    watchFn = /** @type {any} */ (fs.watch),
    readFileFn = (p) => fsPromises.readFile(p, 'utf-8'),
}) {
    const known = new Map(); // relPath -> content hash, or null for "deleted"
    const pending = new Set();
    let timer = null;
    let closed = false;

    async function readHash(relPath) {
        try {
            return { deleted: false, hash: hash(await readFileFn(path.join(root, relPath))) };
        } catch (err) {
            if (err.code === 'ENOENT') return { deleted: true, hash: null };
            return null; // directories (EISDIR), locked files: nothing to report
        }
    }

    async function flush() {
        timer = null;
        const paths = [...pending].sort();
        pending.clear();
        const changes = [];
        for (const relPath of paths) {
            const current = await readHash(relPath);
            if (!current) continue;
            if (known.has(relPath) && known.get(relPath) === current.hash) continue;
            known.set(relPath, current.hash);
            changes.push({ path: relPath, deleted: current.deleted });
        }
        if (changes.length && !closed) onChange(changes);
    }

    const watcher = watchFn(root, { recursive: true }, (_eventType, filename) => {
        if (closed || !filename) return;
        const relPath = String(filename).split(path.sep).join('/');
        if (isIgnored(relPath)) return;
        pending.add(relPath);
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => {
            flush().catch(onError);
        }, debounceMs);
    });
    watcher.on?.('error', onError);

    return {
        /** Records content VRS is about to write (null = about to delete). */
        noteWrite(relPath, content) {
            known.set(relPath, hash(content));
        },
        close() {
            closed = true;
            if (timer) clearTimeout(timer);
            watcher.close();
        },
    };
}
