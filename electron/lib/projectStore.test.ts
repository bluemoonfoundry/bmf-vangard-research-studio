import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { createProject, openProject, readDoc, saveProject } from './projectStore.js';
import { CURRENT_SCHEMA_VERSION } from './projectSchema.js';

const NOW = '2026-10-17T12:00:00.000Z';
const LATER = '2026-10-17T13:00:00.000Z';

let tmp: string;
let root: string;

beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'vrs-store-'));
    root = path.join(tmp, 'Mon Histoire ✨.vrs');
});

afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true });
});

const readJson = async (p: string) => JSON.parse(await fs.readFile(p, 'utf-8'));
const docItem = (id: string, order = 0) => ({ id, parentId: null, type: 'document', title: id, order, keywords: [] });

describe('createProject', () => {
    it('lays out a new project folder', async () => {
        const created = await createProject(root, { id: 'p1', name: 'Mon Histoire', now: NOW });
        expect(created.manifest).toMatchObject({ id: 'p1', name: 'Mon Histoire', schemaVersion: CURRENT_SCHEMA_VERSION });
        expect(await readJson(path.join(root, 'vrs.json'))).toEqual(created.manifest);
        expect(await readJson(path.join(root, 'tree.json'))).toEqual({ items: [] });
        for (const dir of ['docs', 'chats', 'assets', 'bible', 'maps']) {
            expect((await fs.stat(path.join(root, dir))).isDirectory()).toBe(true);
        }
    });

    it('accepts an existing empty folder', async () => {
        await fs.mkdir(root);
        await expect(createProject(root, { id: 'p1', name: 'X', now: NOW })).resolves.toBeDefined();
    });

    it('refuses to create inside a non-empty folder', async () => {
        await fs.mkdir(root);
        await fs.writeFile(path.join(root, 'notes.txt'), 'keep me');
        await expect(createProject(root, { id: 'p1', name: 'X', now: NOW }))
            .rejects.toMatchObject({ code: 'EXISTS' });
        expect(await fs.readFile(path.join(root, 'notes.txt'), 'utf-8')).toBe('keep me');
    });
});

describe('openProject', () => {
    it('round-trips a created project', async () => {
        const created = await createProject(root, { id: 'p1', name: 'X', now: NOW });
        const opened = await openProject(root);
        expect(opened).toEqual({ manifest: created.manifest, tree: { items: [] }, migratedFrom: null });
    });

    it('rejects a folder without vrs.json', async () => {
        await fs.mkdir(root);
        await expect(openProject(root)).rejects.toMatchObject({ code: 'NOT_A_PROJECT' });
    });

    it('reports corrupt JSON instead of opening an empty project', async () => {
        await createProject(root, { id: 'p1', name: 'X', now: NOW });
        await fs.writeFile(path.join(root, 'tree.json'), '{"items": [');
        await expect(openProject(root)).rejects.toMatchObject({ code: 'CORRUPT' });
    });

    it('treats a missing tree.json as an empty tree', async () => {
        await createProject(root, { id: 'p1', name: 'X', now: NOW });
        await fs.unlink(path.join(root, 'tree.json'));
        expect((await openProject(root)).tree).toEqual({ items: [] });
    });

    it('removes temp files left by an interrupted write', async () => {
        await createProject(root, { id: 'p1', name: 'X', now: NOW });
        const stray = path.join(root, 'docs', '.a.md.tmp-1234abcd');
        await fs.writeFile(stray, 'partial');
        await openProject(root);
        await expect(fs.access(stray)).rejects.toThrow();
    });

    it('migrates an older project, keeping a backup of the original files', async () => {
        await createProject(root, { id: 'p1', name: 'X', now: NOW });
        const migrations = { 1: (p: { manifest: object; tree: object }) => ({ ...p, manifest: { ...p.manifest, upgraded: true } }) };
        const opened = await openProject(root, { migrations, currentVersion: 2 });

        expect(opened.migratedFrom).toBe(1);
        expect(await readJson(path.join(root, 'vrs.json'))).toMatchObject({ schemaVersion: 2, upgraded: true });
        expect(await readJson(path.join(root, 'vrs.json.v1.bak'))).toMatchObject({ schemaVersion: 1 });
        expect(await readJson(path.join(root, 'tree.json.v1.bak'))).toEqual({ items: [] });
    });
});

describe('readDoc', () => {
    beforeEach(async () => {
        await createProject(root, { id: 'p1', name: 'X', now: NOW });
    });

    it('returns the document body, or an empty string for a document never saved', async () => {
        await fs.writeFile(path.join(root, 'docs', 'a.md'), '# Héllo');
        expect(await readDoc(root, 'a')).toBe('# Héllo');
        expect(await readDoc(root, 'b')).toBe('');
    });

    it('rejects ids that could escape docs/', async () => {
        await expect(readDoc(root, '../vrs')).rejects.toMatchObject({ code: 'INVALID' });
    });
});

describe('saveProject', () => {
    beforeEach(async () => {
        await createProject(root, { id: 'p1', name: 'X', now: NOW });
    });

    it('writes documents, tree and manifest, and stamps updatedAt', async () => {
        const result = await saveProject(root, {
            manifest: { name: 'Renamed' },
            tree: { items: [docItem('a')] },
            docs: { a: 'Body' },
        }, { now: LATER });

        expect(result.manifest).toMatchObject({ id: 'p1', name: 'Renamed', createdAt: NOW, updatedAt: LATER });
        expect(await readJson(path.join(root, 'vrs.json'))).toEqual(result.manifest);
        expect(await readJson(path.join(root, 'tree.json'))).toEqual({ items: [docItem('a')] });
        expect(await fs.readFile(path.join(root, 'docs', 'a.md'), 'utf-8')).toBe('Body');
    });

    it('deletes documents passed as null, after the tree no longer references them', async () => {
        await saveProject(root, { tree: { items: [docItem('a')] }, docs: { a: 'Body' } }, { now: LATER });
        const writes: string[] = [];
        await saveProject(root, { tree: { items: [] }, docs: { a: null } }, {
            now: LATER,
            onWrite: (rel: string, content: string | null) => writes.push(`${rel}:${content === null ? 'deleted' : 'written'}`),
        });
        await expect(fs.access(path.join(root, 'docs', 'a.md'))).rejects.toThrow();
        expect(writes).toEqual(['tree.json:written', 'vrs.json:written', 'docs/a.md:deleted']);
    });

    it('writes documents before the tree that references them', async () => {
        const writes: string[] = [];
        await saveProject(root, { tree: { items: [docItem('a')] }, docs: { a: 'x' } }, {
            now: LATER, onWrite: (rel: string) => writes.push(rel),
        });
        expect(writes).toEqual(['docs/a.md', 'tree.json', 'vrs.json']);
    });

    it('leaves files that are not part of the request alone', async () => {
        await saveProject(root, { tree: { items: [docItem('a')] }, docs: { a: 'Body' } }, { now: LATER });
        await saveProject(root, { manifest: { name: 'Only name' } }, { now: LATER });
        expect(await readJson(path.join(root, 'tree.json'))).toEqual({ items: [docItem('a')] });
        expect(await fs.readFile(path.join(root, 'docs', 'a.md'), 'utf-8')).toBe('Body');
    });

    it('validates the request before writing anything', async () => {
        await expect(saveProject(root, { tree: { items: [] }, docs: { '../../evil': 'x' } }, { now: LATER }))
            .rejects.toMatchObject({ code: 'INVALID' });
        await expect(fs.access(path.join(tmp, 'evil.md'))).rejects.toThrow();
    });

    it('ignores deleting a document that is already gone', async () => {
        await expect(saveProject(root, { docs: { ghost: null } }, { now: LATER })).resolves.toBeDefined();
    });
});
