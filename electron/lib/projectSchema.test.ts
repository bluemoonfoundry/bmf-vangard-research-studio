import { describe, it, expect } from 'vitest';

type Project = { manifest: object; tree: object };
import {
    CURRENT_SCHEMA_VERSION,
    ProjectFormatError,
    createManifest,
    createEmptyTree,
    migrateProject,
    normalizeTree,
    normalizeBible,
    normalizeExtraction,
    createEmptyExtraction,
    normalizeChat,
    createEmptyBible,
    normalizeText,
    BIBLE_FILE,
    isValidItemId,
    isValidAssetName,
    referencedAssets,
    validateSavePayload,
} from './projectSchema.js';

const NOW = '2026-10-17T12:00:00.000Z';

function v1Manifest(overrides = {}) {
    return { schemaVersion: CURRENT_SCHEMA_VERSION, id: 'p1', name: 'Story', createdAt: NOW, updatedAt: NOW, settings: {}, ...overrides };
}

describe('createManifest / createEmptyTree', () => {
    it('stamps the current schema version', () => {
        const m = createManifest({ id: 'abc', name: 'My Story', now: NOW });
        expect(m).toEqual({
            schemaVersion: CURRENT_SCHEMA_VERSION, id: 'abc', name: 'My Story',
            createdAt: NOW, updatedAt: NOW, settings: {},
        });
        expect(createEmptyTree()).toEqual({ items: [] });
    });
});

describe('migrateProject', () => {
    it('passes a current-version project through untouched', () => {
        const project = { manifest: v1Manifest(), tree: { items: [] } };
        const result = migrateProject(project);
        expect(result.migratedFrom).toBeNull();
        expect(result.project).toEqual(project);
    });

    it('applies each migration step in order and bumps the version', () => {
        const migrations = {
            1: (p: Project) => ({ ...p, manifest: { ...p.manifest, step1: true } }),
            2: (p: Project) => ({ ...p, tree: { ...p.tree, step2: true } }),
        };
        const result = migrateProject({ manifest: v1Manifest({ schemaVersion: 1 }), tree: { items: [] } }, { migrations, currentVersion: 3 });
        expect(result.migratedFrom).toBe(1);
        expect(result.project.manifest).toMatchObject({ schemaVersion: 3, step1: true });
        expect(result.project.tree).toMatchObject({ step2: true });
    });

    it('does not mutate its input', () => {
        const input = { manifest: v1Manifest({ schemaVersion: 1 }), tree: { items: [] } };
        const snapshot = structuredClone(input);
        migrateProject(input, { migrations: { 1: (p: Project) => p }, currentVersion: 2 });
        expect(input).toEqual(snapshot);
    });

    it('refuses projects written by a newer VRS', () => {
        const project = { manifest: v1Manifest({ schemaVersion: CURRENT_SCHEMA_VERSION + 1 }), tree: { items: [] } };
        expect(() => migrateProject(project)).toThrow(expect.objectContaining({ code: 'TOO_NEW' }));
    });

    it.each([undefined, 0, -1, 1.5, '1'])('rejects schemaVersion %j', (schemaVersion) => {
        const project = { manifest: v1Manifest({ schemaVersion }), tree: { items: [] } };
        expect(() => migrateProject(project)).toThrow(ProjectFormatError);
    });

    it('reports a missing migration step instead of skipping it', () => {
        const project = { manifest: v1Manifest({ schemaVersion: 1 }), tree: { items: [] } };
        expect(() => migrateProject(project, { migrations: {}, currentVersion: 2 }))
            .toThrow(expect.objectContaining({ code: 'CORRUPT' }));
    });
});

describe('normalizeTree', () => {
    const item = { id: 'a', parentId: null, type: 'document', title: 'A', order: 0 };

    it('fills optional fields and keeps unknown fields', () => {
        const tree = normalizeTree({ items: [{ ...item, custom: 42 }] });
        expect(tree.items[0]).toMatchObject({ ...item, keywords: [], custom: 42 });
    });

    it('treats a missing tree as empty', () => {
        expect(normalizeTree(undefined)).toEqual({ items: [] });
    });

    it.each([
        ['non-object', 'nope'],
        ['items not an array', { items: {} }],
        ['item without id', { items: [{ ...item, id: undefined }] }],
        ['item with unsafe id', { items: [{ ...item, id: '../evil' }] }],
        ['duplicate ids', { items: [item, item] }],
        ['non-string title', { items: [{ ...item, title: 3 }] }],
        ['non-numeric order', { items: [{ ...item, order: 'x' }] }],
    ])('rejects %s', (_label, raw) => {
        expect(() => normalizeTree(raw)).toThrow(expect.objectContaining({ code: 'CORRUPT' }));
    });
});

describe('isValidItemId', () => {
    it.each(['a', 'abc-123_X', crypto.randomUUID()])('accepts %s', (id) => {
        expect(isValidItemId(id)).toBe(true);
    });
    it.each(['', '../x', 'a/b', 'a\\b', '.hidden', 'x'.repeat(65), 'con.md', 'CON', 'nul', 'com1', 42, null])('rejects %j', (id) => {
        expect(isValidItemId(id)).toBe(false);
    });
});

describe('isValidAssetName', () => {
    it.each(['a.png', `${crypto.randomUUID()}.mp3`, 'x_1.jpeg'])('accepts %s', (name) => {
        expect(isValidAssetName(name)).toBe(true);
    });
    it.each(['a', 'a.PNG', '../a.png', 'a/b.png', '.a.png', 'a.png.tmp-1', 'con.png', 'a.toolongext', 'a b.png', 7])('rejects %j', (name) => {
        expect(isValidAssetName(name)).toBe(false);
    });
});

describe('referencedAssets', () => {
    it('collects valid asset names from items', () => {
        const tree = { items: [{ asset: 'a.png' }, { asset: '../evil' }, {}, { asset: 'b.mp3' }] };
        expect([...referencedAssets(tree)].sort()).toEqual(['a.png', 'b.mp3']);
    });
});

describe('validateSavePayload', () => {
    it('accepts a full payload', () => {
        const payload = { manifest: { name: 'New' }, tree: { items: [] }, docs: { a: 'text', b: null } };
        expect(validateSavePayload(payload)).toEqual(payload);
    });

    it('accepts asset deletions, dropping duplicates', () => {
        expect(validateSavePayload({ deletedAssets: ['a.png', 'a.png'] })).toEqual({ deletedAssets: ['a.png'] });
    });

    it('accepts an empty payload', () => {
        expect(validateSavePayload({})).toEqual({});
    });

    it('only lets the renderer change the name and settings', () => {
        const result = validateSavePayload({ manifest: { name: 'N', settings: { x: 1 }, id: 'hijack', schemaVersion: 99 } });
        expect(result.manifest).toEqual({ name: 'N', settings: { x: 1 } });
    });

    it.each([
        ['non-object', null],
        ['empty name', { manifest: { name: '  ' } }],
        ['bad doc id', { docs: { '../x': 'a' } }],
        ['non-string doc body', { docs: { a: 1 } }],
        ['corrupt tree', { tree: { items: 'x' } }],
        ['asset path', { deletedAssets: ['../a.png'] }],
        ['non-list deletedAssets', { deletedAssets: 'a.png' }],
    ])('rejects %s', (_label, payload) => {
        expect(() => validateSavePayload(payload)).toThrow(expect.objectContaining({ code: 'INVALID' }));
    });
});


describe('schema v2 migration', () => {
    it('upgrades a v1 project to v2', () => {
        const result = migrateProject({ manifest: v1Manifest({ schemaVersion: 1 }), tree: { items: [] } });
        expect(result.migratedFrom).toBe(1);
        expect(result.project.manifest).toMatchObject({ schemaVersion: 2 });
        expect(CURRENT_SCHEMA_VERSION).toBe(2);
    });
});

describe('normalizeText', () => {
    it('trims, collapses whitespace and lower-cases', () => {
        expect(normalizeText('  Hair \t COLOUR\n ')).toBe('hair colour');
    });
});

const fact = (overrides = {}) => ({
    id: 'f1', entityId: 'e1', attribute: 'hair', value: 'red', status: 'proposed', ...overrides,
});
const corrupt = expect.objectContaining({ code: 'CORRUPT' });

describe('normalizeBible', () => {
    it('defaults to an empty bible', () => {
        expect(BIBLE_FILE).toBe('bible/bible.json');
        expect(normalizeBible(undefined)).toEqual(createEmptyBible());
        expect(createEmptyBible()).toEqual({ facts: [], dependencies: [], decisions: [] });
    });

    it('keeps a valid sourceOrder, dropping bad and repeated ids instead of refusing the file', () => {
        const base = { facts: [], dependencies: [], decisions: [] };
        expect(normalizeBible({ ...base, sourceOrder: ['ok-id'] }).sourceOrder).toEqual(['ok-id']);
        expect(normalizeBible({ ...base, sourceOrder: ['a', 42, '../x', 'b', 'a', null] }).sourceOrder).toEqual(['a', 'b']);
        expect(normalizeBible(base)).not.toHaveProperty('sourceOrder');
    });

    it('drops a sourceOrder that is not a list: sources then count as oldest, as before it existed', () => {
        const base = { facts: [], dependencies: [], decisions: [] };
        expect(normalizeBible({ ...base, sourceOrder: 'x' })).not.toHaveProperty('sourceOrder');
    });

    it('rejects a malformed file, naming bible.json', () => {
        expect(() => normalizeBible({ facts: 'x' })).toThrow(/bible\.json/);
        expect(() => normalizeBible({ facts: 'x' })).toThrow(corrupt);
    });

    it('rejects an unknown status', () => {
        expect(() => normalizeBible({ facts: [fact({ status: 'canon' })] })).toThrow(corrupt);
        for (const status of ['proposed', 'kept', 'set_aside']) {
            expect(() => normalizeBible({ facts: [fact({ status })] })).not.toThrow();
        }
    });

    it('requires a position for the "when" attribute', () => {
        expect(() => normalizeBible({ facts: [fact({ attribute: ' When ', value: 'S3' })] })).toThrow(corrupt);
        expect(() => normalizeBible({ facts: [fact({ attribute: ' When ', value: { season: 3, episode: 4 } })] })).not.toThrow();
        expect(() => normalizeBible({ facts: [fact({ attribute: 'when', value: { season: 1, order: 2.5 } })] })).not.toThrow();
        expect(() => normalizeBible({ facts: [fact({ attribute: 'when', value: { season: 0 } })] })).toThrow(corrupt);
        expect(() => normalizeBible({ facts: [fact({ attribute: 'when', value: { season: 1, episode: 0 } })] })).toThrow(corrupt);
        expect(() => normalizeBible({ facts: [fact({ attribute: 'when', value: { season: 1, order: Infinity } })] })).toThrow(corrupt);
    });

    it('requires a string value for other attributes', () => {
        expect(() => normalizeBible({ facts: [fact({ value: 5 })] })).toThrow(corrupt);
        expect(() => normalizeBible({ facts: [fact({ value: { season: 1 } })] })).toThrow(corrupt);
        expect(() => normalizeBible({ facts: [fact({ attribute: '' })] })).toThrow(corrupt);
    });

    it('rejects invalid ids', () => {
        expect(() => normalizeBible({ facts: [fact({ id: '../x' })] })).toThrow(corrupt);
        expect(() => normalizeBible({ facts: [fact({ entityId: '../x' })] })).toThrow(corrupt);
    });

    it('validates a fact source', () => {
        const ok = { itemId: 'd1', quote: 'q', start: 1, end: 3 };
        expect(() => normalizeBible({ facts: [fact({ source: ok })] })).not.toThrow();
        expect(() => normalizeBible({ facts: [fact({ source: { ...ok, itemId: '../x' } })] })).toThrow(corrupt);
        expect(() => normalizeBible({ facts: [fact({ source: { ...ok, quote: 3 } })] })).toThrow(corrupt);
        expect(() => normalizeBible({ facts: [fact({ source: { ...ok, start: 5, end: 3 } })] })).toThrow(corrupt);
        expect(() => normalizeBible({ facts: [fact({ source: { ...ok, start: 1.5 } })] })).toThrow(corrupt);
    });

    it('schema rejects an invalid messageId', () => {
        const ok = { itemId: 'c1', messageId: 'm1', quote: 'q', start: 1, end: 3 };
        expect(() => normalizeBible({ facts: [fact({ source: ok })] })).not.toThrow();
        expect(normalizeBible({ facts: [fact({ source: ok })] }).facts[0].source.messageId).toBe('m1');
        expect(() => normalizeBible({ facts: [fact({ source: { ...ok, messageId: '../x' } })] })).toThrow(corrupt);
        expect(() => normalizeBible({ facts: [fact({ source: { ...ok, messageId: 7 } })] })).toThrow(corrupt);
        expect(() => normalizeBible({ facts: [fact({ source: { ...ok, messageId: '' } })] })).toThrow(corrupt);
    });

    it('validates dependencies', () => {
        const dep = { id: 'd1', eventId: 'e1', afterEventId: 'e2' };
        expect(() => normalizeBible({ dependencies: [dep] })).not.toThrow();
        expect(() => normalizeBible({ dependencies: [{ ...dep, afterEventId: '../x' }] })).toThrow(corrupt);
        expect(() => normalizeBible({ dependencies: [{ ...dep, eventId: 1 }] })).toThrow(corrupt);
    });

    it('validates decisions', () => {
        const dec = { id: 'x1', entityId: 'e1', attribute: 'hair', kind: 'kept_one', factIds: ['f1'], setAsideIds: ['f2'] };
        expect(() => normalizeBible({ decisions: [dec] })).not.toThrow();
        expect(() => normalizeBible({ decisions: [{ ...dec, kind: 'kept_all' }] })).not.toThrow();
        expect(() => normalizeBible({ decisions: [{ ...dec, kind: 'merged' }] })).toThrow(corrupt);
        expect(() => normalizeBible({ decisions: [{ ...dec, factIds: ['../x'] }] })).toThrow(corrupt);
        expect(() => normalizeBible({ decisions: [{ ...dec, setAsideIds: 'f2' }] })).toThrow(corrupt);
        expect(() => normalizeBible({ decisions: [{ ...dec, attribute: 3 }] })).toThrow(corrupt);
    });

    it('preserves unknown fields', () => {
        const bible = normalizeBible({ future: 1, facts: [fact({ extra: { a: 1 } })] });
        expect(bible.facts[0].extra).toEqual({ a: 1 });
        expect(bible.future).toBe(1);
        expect(bible.dependencies).toEqual([]);
    });
});

describe('validateSavePayload bible', () => {
    it('rethrows bible failures as INVALID', () => {
        expect(() => validateSavePayload({ bible: { facts: 'x' } })).toThrow(expect.objectContaining({ code: 'INVALID' }));
    });

    it('passes a valid bible through', () => {
        expect(validateSavePayload({ bible: { facts: [fact()] } }).bible.facts).toHaveLength(1);
    });
});

describe('normalizeChat', () => {
    const chat = { version: 1, settings: { model: 'm' }, messages: [{ id: 'm1', role: 'user', text: 'hi', extra: 1 }], extra: true };

    it('accepts a minimal transcript and keeps unknown fields', () => {
        expect(normalizeChat(chat)).toEqual(chat);
    });

    it('rejects a message with a bad role', () => {
        const bad = { ...chat, messages: [{ id: 'm1', role: 'system', text: 'x' }] };
        expect(() => normalizeChat(bad)).toThrow(expect.objectContaining({ code: 'CORRUPT' }));
    });

    it('rejects version 2 as TOO_NEW', () => {
        expect(() => normalizeChat({ ...chat, version: 2 })).toThrow(expect.objectContaining({ code: 'TOO_NEW' }));
    });

    it('validateSavePayload rejects an invalid chat id', () => {
        expect(() => validateSavePayload({ chats: { '../x': chat } })).toThrow(expect.objectContaining({ code: 'INVALID' }));
        expect(() => validateSavePayload({ chats: { ok: { version: 1 } } })).toThrow(expect.objectContaining({ code: 'INVALID' }));
        expect(validateSavePayload({ chats: { ok: chat, gone: null } }).chats).toEqual({ ok: chat, gone: null });
    });
});

describe('normalizeExtraction', () => {
    const corrupt = /extraction\.json/;
    const source = { itemId: 'chat-1', quote: 'green', start: 0, end: 5 };
    const pending = {
        id: 'p1', ref: { entityId: 'e1' }, attribute: 'eyes', value: 'green', strength: 'suggested',
        evidence: [{ source, strength: 'suggested' }], createdAt: 'T',
    };
    const full = {
        rejections: [{ fingerprint: 'e1\u0000eyes\u0000blue', label: 'Mara · eyes: blue', at: 'T' }],
        runs: [{ itemId: 'chat-1', key: 'k', provider: 'gemini', model: 'm', at: 'T', proposals: [], dropped: 0 }],
        cards: [{ id: 'c1', kind: 'character', title: 'Ivo', reason: 'Recurring', createdAt: 'T' }],
        pending: [pending, { ...pending, id: 'p2', ref: { cardId: 'c1' } }],
        extra: { kept: true },
    };

    it('reads a missing file as empty', () => {
        expect(normalizeExtraction(undefined)).toEqual(createEmptyExtraction());
        expect(createEmptyExtraction()).toEqual({ rejections: [], runs: [], cards: [], pending: [] });
    });

    it('keeps valid entries and unknown fields', () => {
        expect(normalizeExtraction(full)).toEqual(full);
    });

    it('fills missing lists', () => {
        expect(normalizeExtraction({ cards: [] })).toEqual(createEmptyExtraction());
    });

    it('refuses malformed files', () => {
        expect(() => normalizeExtraction([])).toThrow(corrupt);
        expect(() => normalizeExtraction({ pending: 'x' })).toThrow(corrupt);
        expect(() => normalizeExtraction({ pending: [{ ...pending, id: '../x' }] })).toThrow(corrupt);
        expect(() => normalizeExtraction({ pending: [{ ...pending, ref: { entityId: '../e' } }] })).toThrow(corrupt);
        expect(() => normalizeExtraction({ pending: [{ ...pending, ref: {} }] })).toThrow(corrupt);
        expect(() => normalizeExtraction({ pending: [{ ...pending, evidence: [{ source: { ...source, itemId: '../x' }, strength: 'said' }] }] })).toThrow(corrupt);
        expect(() => normalizeExtraction({ cards: [{ id: 'c1', kind: 'character' }] })).toThrow(corrupt);
        expect(() => normalizeExtraction({ runs: [{ itemId: 'a', key: 'k' }] })).toThrow(corrupt);
        expect(() => normalizeExtraction({ rejections: [{ label: 'x' }] })).toThrow(corrupt);
    });

    it('validates conflict flags and dismissals only when present', () => {
        const flag = { id: 'g1', factIds: ['f1', 'f2'], reason: 'Ages disagree.', fingerprint: 'fp', at: 'T' };
        const dismissed = { fingerprint: 'fp2', label: 'age: 24 / born: 40', at: 'T' };
        expect(normalizeExtraction({ flags: [flag], dismissedFlags: [dismissed] })).toEqual({
            ...createEmptyExtraction(), flags: [flag], dismissedFlags: [dismissed],
        });
        expect(normalizeExtraction({})).not.toHaveProperty('flags');
        expect(() => normalizeExtraction({ flags: {} })).toThrow(corrupt);
        expect(() => normalizeExtraction({ flags: [{ ...flag, factIds: ['f1'] }] })).toThrow(corrupt);
        expect(() => normalizeExtraction({ flags: [{ ...flag, factIds: ['f1', '../x'] }] })).toThrow(corrupt);
        expect(() => normalizeExtraction({ flags: [{ ...flag, reason: 1 }] })).toThrow(corrupt);
        expect(() => normalizeExtraction({ dismissedFlags: [{ label: 'x' }] })).toThrow(corrupt);
    });
});

describe('fact evidence', () => {
    const fact = { id: 'f1', entityId: 'e1', attribute: 'eyes', value: 'green', status: 'proposed' };
    const source = { itemId: 'chat-1', quote: 'green', start: 0, end: 5 };

    it('accepts facts with valid evidence', () => {
        const withEvidence = { ...fact, evidence: [{ source, strength: 'said' }] };
        expect(normalizeBible({ facts: [withEvidence] }).facts[0]).toEqual(withEvidence);
    });

    it('refuses evidence with an invalid source', () => {
        expect(() => normalizeBible({ facts: [{ ...fact, evidence: [{ source: { ...source, itemId: '../x' }, strength: 'said' }] }] })).toThrow(/invalid evidence/);
        expect(() => normalizeBible({ facts: [{ ...fact, evidence: 'x' }] })).toThrow(/invalid evidence/);
    });
});

describe('validateSavePayload extraction', () => {
    it('accepts and validates extraction', () => {
        expect(validateSavePayload({ extraction: { cards: [] } }).extraction).toEqual(createEmptyExtraction());
        expect(() => validateSavePayload({ extraction: { pending: 1 } })).toThrow(/extraction\.json/);
    });
});
