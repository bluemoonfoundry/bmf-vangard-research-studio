/**
 * On-disk format of a VRS project folder and the rules for evolving it.
 *
 * A single `schemaVersion` in vrs.json versions the whole folder (vrs.json,
 * tree.json, and later the bible/ files). Migrations upgrade the parsed
 * `{ manifest, tree }` one version at a time; document bodies are plain
 * Markdown and never need migrating.
 */

export const CURRENT_SCHEMA_VERSION = 2;

export const MANIFEST_FILE = 'vrs.json';
export const TREE_FILE = 'tree.json';
export const BIBLE_FILE = 'bible/bible.json';
export const EXTRACTION_FILE = 'bible/extraction.json';
export const CHATS_DIR = 'chats';
export const PROJECT_DIRS = ['docs', 'chats', 'assets', 'bible', 'maps'];

/**
 * `MIGRATIONS[n]` upgrades a version-n project to version n+1. It receives a
 * deep copy and returns the upgraded `{ manifest, tree }`; migrateProject
 * stamps the new schemaVersion itself.
 */
export const MIGRATIONS = {
    // v1 -> v2: the story bible arrives as bible/bible.json. A missing file reads as an empty bible,
    // so there is nothing to rewrite.
    1: (p) => p,
};

export class ProjectFormatError extends Error {
    /** @param {'NOT_A_PROJECT'|'CORRUPT'|'TOO_NEW'|'INVALID'|'EXISTS'|'NO_PROJECT'|'NOT_RECENT'|'NOT_FOUND'|'UNSUPPORTED'|'TOO_LARGE'} code */
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

export function createEmptyBible() {
    return { facts: [], dependencies: [], decisions: [] };
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

/**
 * Imported media lives in assets/<name>, where the main process picks the name
 * (an item-id-style stem plus a lower-case extension). The renderer only ever
 * refers to assets by these names, never by path.
 */
export function isValidAssetName(name) {
    if (typeof name !== 'string') return false;
    const match = /^([A-Za-z0-9][A-Za-z0-9_-]{0,63})\.([a-z0-9]{1,8})$/.exec(name);
    return match !== null && !WINDOWS_RESERVED.test(match[1]);
}

/** Asset names referenced by binder items (`item.asset`). */
export function referencedAssets(tree) {
    return new Set((tree?.items ?? []).map(item => item.asset).filter(isValidAssetName));
}

function isPlainObject(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Matching rule for attribute names and values: trim, collapse whitespace runs, lower-case. */
export function normalizeText(s) {
    return String(s).trim().replace(/\s+/g, ' ').toLowerCase();
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

const FACT_STATUSES = ['proposed', 'kept', 'set_aside'];
const DECISION_KINDS = ['kept_one', 'kept_all'];

const isPositiveInt = (n) => Number.isInteger(n) && n >= 1;

function isValidPosition(value) {
    return isPlainObject(value)
        && isPositiveInt(value.season)
        && (value.episode === undefined || isPositiveInt(value.episode))
        && (value.order === undefined || (typeof value.order === 'number' && Number.isFinite(value.order)));
}

const corruptBible = (where, msg) => new ProjectFormatError('CORRUPT', `bible.json ${where} ${msg}`);

/** A fact's source: `{ itemId, messageId?, quote, start, end }`. */
function isValidSource(src) {
    return isPlainObject(src) && isValidItemId(src.itemId) && typeof src.quote === 'string'
        && Number.isInteger(src.start) && Number.isInteger(src.end) && src.start <= src.end
        && (src.messageId === undefined || isValidItemId(src.messageId));
}

/** Extraction evidence: `[{ source, strength }]`. */
function isValidEvidenceList(list) {
    return Array.isArray(list) && list.every(e => isPlainObject(e) && isValidSource(e.source) && typeof e.strength === 'string');
}

function checkFact(fact, where) {
    if (!isPlainObject(fact)) throw corruptBible(where, 'is not an object.');
    if (!isValidItemId(fact.id)) throw corruptBible(where, 'has an invalid id.');
    if (!isValidItemId(fact.entityId)) throw corruptBible(where, 'has an invalid entityId.');
    if (typeof fact.attribute !== 'string' || !fact.attribute.trim()) throw corruptBible(where, 'needs a non-empty attribute.');
    if (!FACT_STATUSES.includes(fact.status)) throw corruptBible(where, `has an unknown status: ${JSON.stringify(fact.status)}.`);
    if (normalizeText(fact.attribute) === 'when') {
        if (!isValidPosition(fact.value)) throw corruptBible(where, 'needs a story position (season, optional episode and order) as its "when" value.');
    } else if (typeof fact.value !== 'string') {
        throw corruptBible(where, 'needs a string value.');
    }
    if (fact.source !== undefined && !isValidSource(fact.source)) throw corruptBible(where, 'has an invalid source.');
    if (fact.evidence !== undefined && !isValidEvidenceList(fact.evidence)) throw corruptBible(where, 'has invalid evidence.');
}

function checkDependency(dep, where) {
    if (!isPlainObject(dep)) throw corruptBible(where, 'is not an object.');
    for (const key of ['id', 'eventId', 'afterEventId']) {
        if (!isValidItemId(dep[key])) throw corruptBible(where, `has an invalid ${key}.`);
    }
}

function checkDecision(decision, where) {
    if (!isPlainObject(decision)) throw corruptBible(where, 'is not an object.');
    if (!isValidItemId(decision.id)) throw corruptBible(where, 'has an invalid id.');
    if (!isValidItemId(decision.entityId)) throw corruptBible(where, 'has an invalid entityId.');
    if (typeof decision.attribute !== 'string') throw corruptBible(where, 'needs a string attribute.');
    if (!DECISION_KINDS.includes(decision.kind)) throw corruptBible(where, `has an unknown kind: ${JSON.stringify(decision.kind)}.`);
    for (const key of ['factIds', 'setAsideIds']) {
        if (!Array.isArray(decision[key]) || !decision[key].every(isValidItemId)) throw corruptBible(where, `needs ${key} as a list of ids.`);
    }
}

/** Validates bible/bible.json. Unknown fields are preserved, like normalizeTree. */
export function normalizeBible(raw) {
    if (raw === undefined) return createEmptyBible();
    if (!isPlainObject(raw)) throw new ProjectFormatError('CORRUPT', 'bible.json must be an object.');
    const lists = {};
    for (const [key, check] of [['facts', checkFact], ['dependencies', checkDependency], ['decisions', checkDecision]]) {
        const list = raw[key] ?? [];
        if (!Array.isArray(list)) throw new ProjectFormatError('CORRUPT', `bible.json "${key}" must be an array.`);
        const seen = new Set();
        lists[key] = list.map((entry, index) => {
            const where = `${key} entry ${index}`;
            check(entry, where);
            if (seen.has(entry.id)) throw corruptBible(where, `duplicates id ${entry.id}.`);
            seen.add(entry.id);
            return entry;
        });
    }
    if (raw.sourceOrder !== undefined
        && (!Array.isArray(raw.sourceOrder) || !raw.sourceOrder.every(id => isValidItemId(id)))) {
        throw new ProjectFormatError('CORRUPT', 'bible.json "sourceOrder" must be a list of item ids.');
    }
    return { ...raw, ...lists };
}

export function createEmptyExtraction() {
    return { rejections: [], runs: [], cards: [], pending: [] };
}

const corruptExtraction = (where, msg) => new ProjectFormatError('CORRUPT', `extraction.json ${where} ${msg}`);
const isText = (v) => typeof v === 'string';

const EXTRACTION_CHECKS = {
    rejections: (r) => isText(r.fingerprint) && isText(r.label),
    runs: (r) => isValidItemId(r.itemId) && isText(r.key) && Array.isArray(r.proposals),
    cards: (c) => isValidItemId(c.id) && isText(c.kind) && isText(c.title),
    pending: (p) => isValidItemId(p.id)
        && isPlainObject(p.ref) && (isValidItemId(p.ref.entityId) || isValidItemId(p.ref.cardId))
        && isText(p.attribute) && p.attribute.trim() !== ''
        && (isText(p.value) || isValidPosition(p.value))
        && isText(p.strength) && isValidEvidenceList(p.evidence),
};

/**
 * Validates bible/extraction.json: AI extraction's rejections, run cache, pending new cards and
 * pending proposals (src/extraction/types.ts). Missing reads as empty; unknown fields are preserved.
 */
export function normalizeExtraction(raw) {
    if (raw === undefined) return createEmptyExtraction();
    if (!isPlainObject(raw)) throw new ProjectFormatError('CORRUPT', 'extraction.json must be an object.');
    const lists = {};
    for (const [key, check] of Object.entries(EXTRACTION_CHECKS)) {
        const list = raw[key] ?? [];
        if (!Array.isArray(list)) throw new ProjectFormatError('CORRUPT', `extraction.json "${key}" must be an array.`);
        list.forEach((entry, index) => {
            if (!isPlainObject(entry) || !check(entry)) throw corruptExtraction(`${key} entry ${index}`, 'is malformed.');
        });
        lists[key] = list;
    }
    return { ...raw, ...lists };
}

export const CHAT_VERSION = 1;
const CHAT_ROLES = ['user', 'assistant'];

/** Validates chats/<id>.json (spec §4). Unknown fields are preserved, like normalizeTree. */
export function normalizeChat(raw) {
    const corrupt = (msg) => new ProjectFormatError('CORRUPT', `Chat transcript ${msg}`);
    if (!isPlainObject(raw)) throw corrupt('must be an object.');
    if (!isPositiveInt(raw.version)) throw corrupt('has an invalid version.');
    if (raw.version > CHAT_VERSION) {
        throw new ProjectFormatError('TOO_NEW',
            `This chat was saved by a newer version of VRS (format ${raw.version}; this version reads up to ${CHAT_VERSION}).`);
    }
    if (!isPlainObject(raw.settings)) throw corrupt('needs a settings object.');
    if (!Array.isArray(raw.messages)) throw corrupt('needs a messages array.');
    raw.messages.forEach((message, index) => {
        const where = `message ${index}`;
        if (!isPlainObject(message)) throw corrupt(`${where} is not an object.`);
        if (!isValidItemId(message.id)) throw corrupt(`${where} has an invalid id.`);
        if (!CHAT_ROLES.includes(message.role)) throw corrupt(`${where} has an unknown role: ${JSON.stringify(message.role)}.`);
        if (typeof message.text !== 'string') throw corrupt(`${where} needs a string text.`);
    });
    return raw;
}

/**
 * Validates a save (or recovery snapshot) request from the renderer. The
 * renderer may change the project name, settings, tree, bible, document bodies and chat transcripts,
 * and ask for assets to be deleted;
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

    if (payload.bible !== undefined) {
        try {
            result.bible = normalizeBible(payload.bible);
        } catch (err) {
            throw new ProjectFormatError('INVALID', err.message);
        }
    }

    if (payload.extraction !== undefined) {
        try {
            result.extraction = normalizeExtraction(payload.extraction);
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

    if (payload.chats !== undefined) {
        if (!isPlainObject(payload.chats)) throw new ProjectFormatError('INVALID', 'chats must be an object.');
        for (const [id, transcript] of Object.entries(payload.chats)) {
            if (!isValidItemId(id)) throw new ProjectFormatError('INVALID', `Invalid chat id: ${id}`);
            if (transcript === null) continue;
            try {
                normalizeChat(transcript);
            } catch (err) {
                throw new ProjectFormatError('INVALID', err.message);
            }
        }
        result.chats = payload.chats;
    }

    if (payload.deletedAssets !== undefined) {
        if (!Array.isArray(payload.deletedAssets) || !payload.deletedAssets.every(isValidAssetName)) {
            throw new ProjectFormatError('INVALID', 'deletedAssets must be a list of asset names.');
        }
        result.deletedAssets = [...new Set(payload.deletedAssets)];
    }

    return result;
}
