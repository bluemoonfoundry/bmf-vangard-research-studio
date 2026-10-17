import fs from 'fs/promises';
import path from 'path';
import { atomicWriteFile, cleanupStaleTempFiles } from './atomicFileWrite.js';
import { validateProjectPath } from './ipcSecurity.js';
import {
    MANIFEST_FILE,
    TREE_FILE,
    PROJECT_DIRS,
    ProjectFormatError,
    createManifest,
    createEmptyTree,
    isValidItemId,
    migrateProject,
    normalizeTree,
    validateSavePayload,
} from './projectSchema.js';

/**
 * Reads and writes a VRS project folder. Every function takes the project
 * root explicitly, so nothing here assumes a single open project (a shared
 * research library later is just another root).
 */

const toJson = (value) => `${JSON.stringify(value, null, 2)}\n`;

async function readJsonFile(filePath, { optional = false } = {}) {
    let text;
    try {
        text = await fs.readFile(filePath, 'utf-8');
    } catch (err) {
        if (err.code === 'ENOENT' && optional) return undefined;
        throw err;
    }
    try {
        return JSON.parse(text);
    } catch {
        throw new ProjectFormatError('CORRUPT', `${path.basename(filePath)} is not valid JSON.`);
    }
}

/** Resolves a project-relative path and re-checks containment (defence in depth on top of id validation). */
async function resolveInside(root, relPath) {
    const full = path.join(root, relPath);
    const error = await validateProjectPath(full, root);
    if (error) throw new ProjectFormatError('INVALID', `${relPath}: ${error}`);
    return full;
}

function docRelPath(id) {
    if (!isValidItemId(id)) throw new ProjectFormatError('INVALID', `Invalid document id: ${id}`);
    return `docs/${id}.md`;
}

export async function createProject(root, { id, name, now }) {
    try {
        const entries = await fs.readdir(root);
        if (entries.length > 0) {
            throw new ProjectFormatError('EXISTS', `${root} already exists and is not empty.`);
        }
    } catch (err) {
        if (err.code !== 'ENOENT') throw err;
    }

    await fs.mkdir(root, { recursive: true });
    for (const dir of PROJECT_DIRS) {
        await fs.mkdir(path.join(root, dir), { recursive: true });
    }
    const manifest = createManifest({ id, name, now });
    const tree = createEmptyTree();
    await atomicWriteFile(path.join(root, TREE_FILE), toJson(tree));
    // vrs.json last: a folder is only recognised as a project once it's complete.
    await atomicWriteFile(path.join(root, MANIFEST_FILE), toJson(manifest));
    return { manifest, tree };
}

export async function openProject(root, migrationOptions) {
    const manifestPath = path.join(root, MANIFEST_FILE);
    const treePath = path.join(root, TREE_FILE);

    const rawManifest = await readJsonFile(manifestPath, { optional: true });
    if (rawManifest === undefined) {
        throw new ProjectFormatError('NOT_A_PROJECT', `${root} is not a VRS project (no ${MANIFEST_FILE}).`);
    }
    const rawTree = await readJsonFile(treePath, { optional: true });

    await cleanupStaleTempFiles(root);

    const { project, migratedFrom } = migrateProject({ manifest: rawManifest, tree: rawTree ?? createEmptyTree() }, migrationOptions);
    const tree = normalizeTree(project.tree);

    if (migratedFrom !== null) {
        // Keep the pre-migration files so an upgrade is always reversible by hand.
        await fs.copyFile(manifestPath, `${manifestPath}.v${migratedFrom}.bak`);
        if (rawTree !== undefined) await fs.copyFile(treePath, `${treePath}.v${migratedFrom}.bak`);
        await atomicWriteFile(treePath, toJson(tree));
        await atomicWriteFile(manifestPath, toJson(project.manifest));
    }

    return { manifest: project.manifest, tree, migratedFrom };
}

export async function readDoc(root, id) {
    const full = await resolveInside(root, docRelPath(id));
    try {
        return await fs.readFile(full, 'utf-8');
    } catch (err) {
        if (err.code === 'ENOENT') return '';
        throw err;
    }
}

/** Re-reads only the structure files, for picking up changes made outside VRS. */
export async function readStructure(root) {
    const { manifest, tree } = await openProject(root);
    return { manifest, tree };
}

/**
 * Saves the parts of a project named in `payload` ({ manifest?, tree?, docs? }).
 *
 * Each file is written atomically, and the order keeps the folder consistent
 * if the save is interrupted part-way: document bodies first, then the tree
 * that references them, then vrs.json, and deletions only once nothing
 * references the deleted documents. The worst case is an orphaned docs/*.md,
 * never a tree entry pointing at a missing or half-written file.
 *
 * `onWrite(relPath, content|null)` is called before each write/delete so the
 * external-change watcher can recognise VRS's own writes.
 *
 * @param {string} root
 * @param {unknown} payload
 * @param {{ now?: string, onWrite?: (relPath: string, content: string | null) => void }} [options]
 */
export async function saveProject(root, payload, { now, onWrite = () => {} } = {}) {
    const request = validateSavePayload(payload);
    const docs = Object.entries(request.docs ?? {});

    const write = async (relPath, content) => {
        const full = await resolveInside(root, relPath);
        onWrite(relPath, content);
        await atomicWriteFile(full, content);
    };

    for (const [id, body] of docs) {
        if (body !== null) await write(docRelPath(id), body);
    }
    if (request.tree) await write(TREE_FILE, toJson(request.tree));

    const current = await readJsonFile(path.join(root, MANIFEST_FILE));
    const manifest = { ...current, ...request.manifest, updatedAt: now };
    await write(MANIFEST_FILE, toJson(manifest));

    for (const [id, body] of docs) {
        if (body !== null) continue;
        const relPath = docRelPath(id);
        const full = await resolveInside(root, relPath);
        onWrite(relPath, null);
        await fs.rm(full, { force: true });
    }

    return { manifest };
}
