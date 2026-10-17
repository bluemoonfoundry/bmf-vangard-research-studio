/**
 * On-disk format of a VRS project folder and the rules for evolving it.
 *
 * A single `schemaVersion` in vrs.json versions the whole folder (vrs.json,
 * tree.json, and later the bible/ files). Migrations upgrade the parsed
 * `{ manifest, tree }` one version at a time; document bodies are plain
 * Markdown and never need migrating.
 */

export const CURRENT_SCHEMA_VERSION = 1;

export const MANIFEST_FILE = 'vrs.json';
export const TREE_FILE = 'tree.json';
export const PROJECT_DIRS = ['docs', 'chats', 'assets', 'bible', 'maps'];

/**
 * `MIGRATIONS[n]` upgrades a version-n project to version n+1. It receives a
 * deep copy and returns the upgraded `{ manifest, tree }`; migrateProject
 * stamps the new schemaVersion itself.
 */
export const MIGRATIONS = {};

export class ProjectFormatError extends Error {
    /** @param {'NOT_A_PROJECT'|'CORRUPT'|'TOO_NEW'|'INVALID'|'EXISTS'|'NO_PROJECT'|'NOT_RECENT'} code */
    constructor(code, message) {
        super(message);
        this.name = 'ProjectFormatError';
        this.code = code;
    }
}

export function createManifest({ id, name, now }) {
    return { schemaVersion: CURRENT_SCHEMA_VERSION, id, name, createdAt: now, updatedAt: now, settings: {} };
}

export function createEmptyTree() {
    return { items: [] };
}

const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i;

/**
 * Item ids become file names (docs/<id>.md, chats/<id>.json), so they're
 * restricted to a filename-safe alphabet: no separators, dots, or Windows
 * device names. crypto.randomUUID() output always qualifies.
 */
export function isValidItemId(id) {
    return typeof id === 'string'
        && /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(id)
        && !WINDOWS_RESERVED.test(id);
}

function isPlainObject(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * @param {{ manifest: any, tree: any }} project
 * @param {{ migrations?: Record<number, (project: any) => any>, currentVersion?: number }} [options]
 */
export function migrateProject(project, { migrations = MIGRATIONS, currentVersion = CURRENT_SCHEMA_VERSION } = {}) {
    const version = project?.manifest?.schemaVersion;
    if (!Number.isInteger(version) || version < 1) {
        throw new ProjectFormatError('CORRUPT', `vrs.json has an invalid schemaVersion: ${JSON.stringify(version)}`);
    }
    if (version > currentVersion) {
        throw new ProjectFormatError('TOO_NEW',
            `This project was saved by a newer version of VRS (format ${version}; this version reads up to ${currentVersion}).`);
    }
    if (version === currentVersion) {
        return { project, migratedFrom: null };
    }

    let migrated = structuredClone(project);
    for (let v = version; v < currentVersion; v++) {
        const step = migrations[v];
        if (typeof step !== 'function') {
            throw new ProjectFormatError('CORRUPT', `No migration from project format ${v} to ${v + 1}.`);
        }
        migrated = step(migrated);
        migrated.manifest = { ...migrated.manifest, schemaVersion: v + 1 };
    }
    return { project: migrated, migratedFrom: version };
}

/** Validates tree.json. Unknown fields are preserved so newer data isn't silently dropped. */
export function normalizeTree(raw) {
    if (raw === undefined) return createEmptyTree();
    if (!isPlainObject(raw) || !Array.isArray(raw.items)) {
        throw new ProjectFormatError('CORRUPT', 'tree.json must be an object with an "items" array.');
    }
    const seen = new Set();
    const items = raw.items.map((item, index) => {
        const where = `tree.json item ${index}`;
        if (!isPlainObject(item)) throw new ProjectFormatError('CORRUPT', `${where} is not an object.`);
        if (!isValidItemId(item.id)) throw new ProjectFormatError('CORRUPT', `${where} has an invalid id.`);
        if (seen.has(item.id)) throw new ProjectFormatError('CORRUPT', `${where} duplicates id ${item.id}.`);
        seen.add(item.id);
        if (item.parentId !== null && typeof item.parentId !== 'string') {
            throw new ProjectFormatError('CORRUPT', `${where} has an invalid parentId.`);
        }
        if (typeof item.type !== 'string' || typeof item.title !== 'string') {
            throw new ProjectFormatError('CORRUPT', `${where} needs a string type and title.`);
        }
        if (typeof item.order !== 'number' || !Number.isFinite(item.order)) {
            throw new ProjectFormatError('CORRUPT', `${where} has a non-numeric order.`);
        }
        return { keywords: [], ...item };
    });
    return { ...raw, items };
}

/**
 * Validates a save (or recovery snapshot) request from the renderer. The
 * renderer may change the project name, settings, tree and document bodies;
 * identity fields (id, schemaVersion, timestamps) are owned by the main process.
 */
export function validateSavePayload(payload) {
    if (!isPlainObject(payload)) throw new ProjectFormatError('INVALID', 'Save request must be an object.');
    const result = {};

    if (payload.manifest !== undefined) {
        const { name, settings } = payload.manifest ?? {};
        if (typeof name !== 'string' || !name.trim()) {
            throw new ProjectFormatError('INVALID', 'Project name must be a non-empty string.');
        }
        result.manifest = { name };
        if (settings !== undefined) {
            if (!isPlainObject(settings)) throw new ProjectFormatError('INVALID', 'Project settings must be an object.');
            result.manifest.settings = settings;
        }
    }

    if (payload.tree !== undefined) {
        try {
            result.tree = normalizeTree(payload.tree);
        } catch (err) {
            throw new ProjectFormatError('INVALID', err.message);
        }
    }

    if (payload.docs !== undefined) {
        if (!isPlainObject(payload.docs)) throw new ProjectFormatError('INVALID', 'docs must be an object.');
        for (const [id, body] of Object.entries(payload.docs)) {
            if (!isValidItemId(id)) throw new ProjectFormatError('INVALID', `Invalid document id: ${id}`);
            if (body !== null && typeof body !== 'string') {
                throw new ProjectFormatError('INVALID', `Document ${id} must be a string or null.`);
            }
        }
        result.docs = payload.docs;
    }

    return result;
}
