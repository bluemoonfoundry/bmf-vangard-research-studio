import { describe, it, expect } from 'vitest';

type Project = { manifest: object; tree: object };
import {
    CURRENT_SCHEMA_VERSION,
    ProjectFormatError,
    createManifest,
    createEmptyTree,
    migrateProject,
    normalizeTree,
    isValidItemId,
    validateSavePayload,
} from './projectSchema.js';

const NOW = '2026-10-17T12:00:00.000Z';

function v1Manifest(overrides = {}) {
    return { schemaVersion: 1, id: 'p1', name: 'Story', createdAt: NOW, updatedAt: NOW, settings: {}, ...overrides };
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
        const result = migrateProject({ manifest: v1Manifest(), tree: { items: [] } }, { migrations, currentVersion: 3 });
        expect(result.migratedFrom).toBe(1);
        expect(result.project.manifest).toMatchObject({ schemaVersion: 3, step1: true });
        expect(result.project.tree).toMatchObject({ step2: true });
    });

    it('does not mutate its input', () => {
        const input = { manifest: v1Manifest(), tree: { items: [] } };
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
        const project = { manifest: v1Manifest(), tree: { items: [] } };
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

describe('validateSavePayload', () => {
    it('accepts a full payload', () => {
        const payload = { manifest: { name: 'New' }, tree: { items: [] }, docs: { a: 'text', b: null } };
        expect(validateSavePayload(payload)).toEqual(payload);
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
    ])('rejects %s', (_label, payload) => {
        expect(() => validateSavePayload(payload)).toThrow(expect.objectContaining({ code: 'INVALID' }));
    });
});
