import fs from 'fs/promises';
import path from 'path';
import { atomicCopyFile, atomicWriteFile, cleanupStaleTempFiles } from './atomicFileWrite.js';
import { validateProjectPath } from './ipcSecurity.js';
import {
    MANIFEST_FILE,
    TREE_FILE,
    BIBLE_FILE,
    PROJECT_DIRS,
    ProjectFormatError,
    createManifest,
    createEmptyTree,
    createEmptyBible,
    isValidAssetName,
    isValidItemId,
    migrateProject,
    normalizeTree,
    normalizeBible,
    normalizeChat,
    referencedAssets,
    validateSavePayload,
} from './projectSchema.js';
import { MAX_ASSET_BYTES, mediaExtension } from './media.js';

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

function chatRelPath(id) {
    if (!isValidItemId(id)) throw new ProjectFormatError('INVALID', `Invalid chat id: ${id}`);
    return `chats/${id}.json`;
}

function assetRelPath(name) {
    if (!isValidAssetName(name)) throw new ProjectFormatError('INVALID', `Invalid asset name: ${name}`);
    return `assets/${name}`;
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
    return { manifest, tree, bible: createEmptyBible() };
}

export async function openProject(root, migrationOptions) {
    const manifestPath = path.join(root, MANIFEST_FILE);
    const treePath = path.join(root, TREE_FILE);

    const rawManifest = await readJsonFile(manifestPath, { optional: true });
    if (rawManifest === undefined) {
        throw new ProjectFormatError('NOT_A_PROJECT', `${root} is not a VRS project (no ${MANIFEST_FILE}).`);
    }
    const rawTree = await readJsonFile(treePath, { optional: true });
    const rawBible = await readJsonFile(path.join(root, BIBLE_FILE), { optional: true });

    await cleanupStaleTempFiles(root);

    const { project, migratedFrom } = migrateProject({ manifest: rawManifest, tree: rawTree ?? createEmptyTree() }, migrationOptions);
    const tree = normalizeTree(project.tree);
    const bible = normalizeBible(rawBible);

    if (migratedFrom !== null) {
        // Keep the pre-migration files so an upgrade is always reversible by hand.
        await fs.copyFile(manifestPath, `${manifestPath}.v${migratedFrom}.bak`);
        if (rawTree !== undefined) await fs.copyFile(treePath, `${treePath}.v${migratedFrom}.bak`);
        await atomicWriteFile(treePath, toJson(tree));
        await atomicWriteFile(manifestPath, toJson(project.manifest));
    }

    return { manifest: project.manifest, tree, bible, migratedFrom };
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

/**
 * Reads chats/<id>.json. A missing file is an unremarkable "no transcript yet"; a damaged or
 * too-new one comes back as `problem` text so the chat can say so without failing the project.
 */
export async function readChat(root, id) {
    const full = await resolveInside(root, chatRelPath(id));
    let text;
    try {
        text = await fs.readFile(full, 'utf-8');
    } catch (err) {
        if (err.code === 'ENOENT') return { transcript: null, problem: null };
        throw err;
    }
    try {
        return { transcript: normalizeChat(JSON.parse(text)), problem: null };
    } catch (err) {
        if (err instanceof ProjectFormatError) return { transcript: null, problem: err.message };
        return { transcript: null, problem: `chats/${id}.json is not valid JSON.` };
    }
}

/** Reads an imported asset's bytes. */
export async function readAsset(root, name) {
    const full = await resolveInside(root, assetRelPath(name));
    try {
        return await fs.readFile(full);
    } catch (err) {
        if (err.code === 'ENOENT') throw new ProjectFormatError('NOT_FOUND', `The file for ${name} is missing from assets/.`);
        throw err;
    }
}

/**
 * Copies a user-picked media file into assets/ under a name chosen here (never
 * by the renderer), so it travels with the project folder.
 *
 * @param {string} root
 * @param {string} sourcePath  must come from a native open dialog
 * @param {{ kind: 'image' | 'audio', newId: string }} options
 */
export async function importAsset(root, sourcePath, { kind, newId }) {
    const ext = mediaExtension(sourcePath, kind);
    const { size } = await fs.stat(sourcePath);
    if (size > MAX_ASSET_BYTES) {
        throw new ProjectFormatError('TOO_LARGE', `${path.basename(sourcePath)} is larger than ${MAX_ASSET_BYTES / 1024 / 1024} MB.`);
    }
    const asset = `${newId}.${ext}`;
    const full = await resolveInside(root, assetRelPath(asset));
    await fs.mkdir(path.dirname(full), { recursive: true });
    await atomicCopyFile(sourcePath, full);
    return { asset, originalName: path.basename(sourcePath, path.extname(sourcePath)), bytes: size };
}

/** Re-reads only the structure files, for picking up changes made outside VRS. */
export async function readStructure(root) {
    const { manifest, tree, bible } = await openProject(root);
    return { manifest, tree, bible };
}

/**
 * Saves the parts of a project named in `payload` ({ manifest?, tree?, bible?, docs?, chats?, deletedAssets? }).
 *
 * Each file is written atomically, and the order keeps the folder consistent
 * if the save is interrupted part-way: document bodies, then chat
 * transcripts, then the tree that references them, then bible/bible.json, then vrs.json, and
 * deletions (docs, chats, assets) only once nothing references the deleted files. The worst case is an orphaned docs/*.md,
 * never a tree entry pointing at a missing or half-written file. Assets the
 * saved tree still references (e.g. shared by a duplicated item) are kept.
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
    const chats = Object.entries(request.chats ?? {});

    const write = async (relPath, content) => {
        const full = await resolveInside(root, relPath);
        onWrite(relPath, content);
        // bible/ is empty in git, so a cloned project may not have it yet.
        await fs.mkdir(path.dirname(full), { recursive: true });
        await atomicWriteFile(full, content);
    };

    for (const [id, body] of docs) {
        if (body !== null) await write(docRelPath(id), body);
    }
    for (const [id, transcript] of chats) {
        if (transcript !== null) await write(chatRelPath(id), toJson(transcript));
    }
    if (request.tree) await write(TREE_FILE, toJson(request.tree));
    if (request.bible) await write(BIBLE_FILE, toJson(request.bible));

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

    for (const [id, transcript] of chats) {
        if (transcript !== null) continue;
        const relPath = chatRelPath(id);
        const full = await resolveInside(root, relPath);
        onWrite(relPath, null);
        await fs.rm(full, { force: true });
    }

    if (request.deletedAssets?.length) {
        const tree = request.tree ?? await readJsonFile(path.join(root, TREE_FILE), { optional: true });
        const stillUsed = referencedAssets(tree);
        for (const name of request.deletedAssets) {
            if (stillUsed.has(name)) continue;
            const relPath = assetRelPath(name);
            const full = await resolveInside(root, relPath);
            onWrite(relPath, null);
            await fs.rm(full, { force: true });
        }
    }

    return { manifest };
}
