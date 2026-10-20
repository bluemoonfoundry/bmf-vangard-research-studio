import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { assetPath, checkAsset, createProject, importAsset, openProject, readChat, readDoc, readStructure, saveProject } from './projectStore.js';
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

    it('returns an empty bible, so a brand-new project can hold facts', async () => {
        const created = await createProject(root, { id: 'p1', name: 'X', now: NOW });
        expect(created.bible).toEqual({ facts: [], dependencies: [], decisions: [] });
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
        expect(opened).toEqual({
            manifest: created.manifest, tree: { items: [] }, bible: { facts: [], dependencies: [], decisions: [] },
            extraction: { rejections: [], runs: [], cards: [], pending: [] }, migratedFrom: null,
        });
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
        const from = CURRENT_SCHEMA_VERSION;
        const migrations = { [from]: (p: { manifest: object; tree: object }) => ({ ...p, manifest: { ...p.manifest, upgraded: true } }) };
        const opened = await openProject(root, { migrations, currentVersion: from + 1 });

        expect(opened.migratedFrom).toBe(from);
        expect(await readJson(path.join(root, 'vrs.json'))).toMatchObject({ schemaVersion: from + 1, upgraded: true });
        expect(await readJson(path.join(root, `vrs.json.v${from}.bak`))).toMatchObject({ schemaVersion: from });
        expect(await readJson(path.join(root, `tree.json.v${from}.bak`))).toEqual({ items: [] });
    });

    it('opens a v1 folder without bible.json as an empty bible and migrates it', async () => {
        await createProject(root, { id: 'p1', name: 'X', now: NOW });
        const manifest = await readJson(path.join(root, 'vrs.json'));
        await fs.writeFile(path.join(root, 'vrs.json'), JSON.stringify({ ...manifest, schemaVersion: 1 }));
        const opened = await openProject(root);
        expect(opened.migratedFrom).toBe(1);
        expect(opened.manifest.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
        expect(opened.bible).toEqual({ facts: [], dependencies: [], decisions: [] });
    });

    it('opens a v2 project with plain-text ages, keeping them and a v2 backup', async () => {
        await createProject(root, { id: 'p1', name: 'X', now: NOW });
        const manifest = await readJson(path.join(root, 'vrs.json'));
        await fs.writeFile(path.join(root, 'vrs.json'), JSON.stringify({ ...manifest, schemaVersion: 2 }));
        const ages = ['6', '18'].map((value, i) => ({
            id: `f${i}`, entityId: 'e1', attribute: 'Age', value, status: 'kept', origin: 'manual', createdAt: NOW, updatedAt: NOW,
        }));
        await fs.writeFile(path.join(root, 'bible', 'bible.json'), JSON.stringify({ facts: ages, dependencies: [], decisions: [] }));
        const opened = await openProject(root);
        expect(opened.migratedFrom).toBe(2);
        expect(opened.manifest.schemaVersion).toBe(3);
        expect(opened.bible.facts.map((f: { value: unknown }) => f.value)).toEqual(['6', '18']);
        expect(await readJson(path.join(root, 'vrs.json.v2.bak'))).toMatchObject({ schemaVersion: 2 });
    });

    it('rejects a corrupt bible.json', async () => {
        await createProject(root, { id: 'p1', name: 'X', now: NOW });
        await fs.writeFile(path.join(root, 'bible', 'bible.json'), '{"facts": "x"}');
        await expect(openProject(root)).rejects.toMatchObject({ code: 'CORRUPT' });
        await fs.writeFile(path.join(root, 'bible', 'bible.json'), '{nope');
        await expect(openProject(root)).rejects.toMatchObject({ code: 'CORRUPT' });
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

describe('assets', () => {
    let source: string;

    beforeEach(async () => {
        await createProject(root, { id: 'p1', name: 'X', now: NOW });
        source = path.join(tmp, 'Harbour Map.PNG');
        await fs.writeFile(source, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2]));
    });

    it('copies an imported file into assets/ under a name it picks', async () => {
        const imported = await importAsset(root, source, { kind: 'image', newId: 'abc' });
        expect(imported).toEqual({ asset: 'abc.png', originalName: 'Harbour Map', bytes: 7 });
        expect(await fs.readFile(await assetPath(root, 'abc.png'))).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2]));
        expect(await checkAsset(root, 'abc.png')).toEqual({ bytes: 7 });
    });

    it('refuses files of the wrong kind', async () => {
        await expect(importAsset(root, source, { kind: 'audio', newId: 'abc' })).rejects.toMatchObject({ code: 'UNSUPPORTED' });
        await expect(importAsset(root, source, { kind: 'video' as 'image', newId: 'abc' })).rejects.toMatchObject({ code: 'INVALID' });
        expect(await fs.readdir(path.join(root, 'assets'))).toEqual([]);
    });

    it('rejects asset names that could escape assets/', async () => {
        await expect(assetPath(root, '../vrs.json')).rejects.toMatchObject({ code: 'INVALID' });
        await expect(checkAsset(root, '../vrs.json')).rejects.toMatchObject({ code: 'INVALID' });
    });

    it('reports a missing asset file', async () => {
        await expect(checkAsset(root, 'gone.png')).rejects.toMatchObject({ code: 'NOT_FOUND', message: expect.stringContaining('gone.png') });
    });

    it('reports a folder in place of an asset as missing', async () => {
        await fs.mkdir(path.join(root, 'assets', 'dir.png'), { recursive: true });
        await expect(checkAsset(root, 'dir.png')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });

    it('deletes requested assets on save, after the tree, unless still referenced', async () => {
        await importAsset(root, source, { kind: 'image', newId: 'old' });
        await importAsset(root, source, { kind: 'image', newId: 'shared' });
        const writes: string[] = [];
        await saveProject(root, {
            tree: { items: [{ ...docItem('a'), asset: 'shared.png' }] },
            deletedAssets: ['old.png', 'shared.png'],
        }, { now: LATER, onWrite: (rel: string, content: string | null) => writes.push(`${rel}:${content === null ? 'deleted' : 'written'}`) });

        expect(await fs.readdir(path.join(root, 'assets'))).toEqual(['shared.png']);
        expect(writes).toEqual(['tree.json:written', 'vrs.json:written', 'assets/old.png:deleted']);
    });

    it('checks references against the tree on disk when the save does not change it', async () => {
        await importAsset(root, source, { kind: 'image', newId: 'kept' });
        await saveProject(root, { tree: { items: [{ ...docItem('a'), asset: 'kept.png' }] } }, { now: LATER });
        await saveProject(root, { deletedAssets: ['kept.png'] }, { now: LATER });
        expect(await fs.readdir(path.join(root, 'assets'))).toEqual(['kept.png']);
    });
});


describe('bible persistence', () => {
    const bible = {
        facts: [{ id: 'f1', entityId: 'e1', attribute: 'hair', value: 'red', status: 'kept' }],
        dependencies: [],
        decisions: [],
    };

    beforeEach(async () => {
        await createProject(root, { id: 'p1', name: 'X', now: NOW });
    });

    it('writes bible/bible.json between the tree and the manifest', async () => {
        const writes: string[] = [];
        await saveProject(root, { docs: { a: 'text' }, tree: { items: [docItem('a')] }, bible },
            { now: LATER, onWrite: (rel) => writes.push(rel) });
        expect(writes).toEqual(['docs/a.md', 'tree.json', 'bible/bible.json', 'vrs.json']);
        expect(await readJson(path.join(root, 'bible', 'bible.json'))).toEqual(bible);
    });

    it('readStructure returns the saved bible', async () => {
        await saveProject(root, { bible }, { now: LATER });
        expect((await readStructure(root)).bible).toEqual(bible);
    });

    it('creates bible/ when a cloned project lacks the empty folder', async () => {
        await fs.rm(path.join(root, 'bible'), { recursive: true, force: true });
        await saveProject(root, { bible }, { now: LATER });
        expect(await readJson(path.join(root, 'bible', 'bible.json'))).toEqual(bible);
    });

    it('leaves bible.json alone when the save has no bible', async () => {
        await saveProject(root, { bible }, { now: LATER });
        await saveProject(root, { manifest: { name: 'Y' } }, { now: LATER });
        expect(await readJson(path.join(root, 'bible', 'bible.json'))).toEqual(bible);
    });
});

describe('chat transcripts', () => {
    const chat = { version: 1, settings: {}, messages: [{ id: 'm1', role: 'user', text: 'hi' }] };

    beforeEach(async () => {
        await createProject(root, { id: 'p1', name: 'X', now: NOW });
    });

    it('writes chats before tree.json', async () => {
        const writes: string[] = [];
        await saveProject(root, { docs: { a: 'text' }, chats: { c: chat }, tree: { items: [docItem('a')] } },
            { now: LATER, onWrite: (rel) => writes.push(rel) });
        expect(writes).toEqual(['docs/a.md', 'chats/c.json', 'tree.json', 'vrs.json']);
        expect(await readJson(path.join(root, 'chats', 'c.json'))).toEqual(chat);
        expect((await readChat(root, 'c')).transcript).toEqual(chat);
    });

    it('deletes a chat file on null', async () => {
        await saveProject(root, { chats: { c: chat } }, { now: LATER });
        const writes: string[] = [];
        await saveProject(root, { chats: { c: null } }, { now: LATER, onWrite: (rel, content) => writes.push(`${rel}:${content}`) });
        await expect(fs.stat(path.join(root, 'chats', 'c.json'))).rejects.toMatchObject({ code: 'ENOENT' });
        expect(writes).toContain('chats/c.json:null');
    });

    it('readChat: missing -> null without problem', async () => {
        expect(await readChat(root, 'nope')).toEqual({ transcript: null, problem: null });
    });

    it('readChat: corrupt -> problem message', async () => {
        await fs.writeFile(path.join(root, 'chats', 'bad.json'), '{ not json');
        await fs.writeFile(path.join(root, 'chats', 'odd.json'), '{"version":1,"settings":{},"messages":[{"id":"m","role":"bot","text":""}]}');
        const bad = await readChat(root, 'bad');
        expect(bad.transcript).toBeNull();
        expect(bad.problem).toEqual(expect.any(String));
        const odd = await readChat(root, 'odd');
        expect(odd.transcript).toBeNull();
        expect(odd.problem).toMatch(/role/);
    });

    it('readChat: any other read failure -> problem message, not a throw', async () => {
        // A directory where the file should be fails with EISDIR (EACCES and the like take the same path).
        await fs.mkdir(path.join(root, 'chats', 'dir.json'));
        const dir = await readChat(root, 'dir');
        expect(dir.transcript).toBeNull();
        expect(dir.problem).toMatch(/chats\/dir\.json/);
        const spy = vi.spyOn(fs, 'readFile').mockRejectedValueOnce(Object.assign(new Error('EACCES: permission denied, open C:/secret/path'), { code: 'EACCES' }));
        try {
            const denied = await readChat(root, 'locked');
            expect(denied.transcript).toBeNull();
            expect(denied.problem).toMatch(/chats\/locked\.json/);
            expect(denied.problem).toMatch(/EACCES/);
            expect(denied.problem).not.toMatch(/secret/);
        } finally {
            spy.mockRestore();
        }
    });

    it('readChat rejects an invalid id', async () => {
        await expect(readChat(root, '../vrs')).rejects.toMatchObject({ code: 'INVALID' });
    });
});

describe('extraction persistence', () => {
    const bible = { facts: [], dependencies: [], decisions: [] };
    const extraction = {
        rejections: [], runs: [], pending: [],
        cards: [{ id: 'c1', kind: 'character', title: 'Ivo', reason: '', createdAt: NOW }],
    };

    beforeEach(async () => {
        await createProject(root, { id: 'p1', name: 'X', now: NOW });
    });

    it('opens a project without extraction.json as empty', async () => {
        expect((await openProject(root)).extraction).toEqual({ rejections: [], runs: [], cards: [], pending: [] });
    });

    it('writes bible/extraction.json right after bible/bible.json', async () => {
        const writes: string[] = [];
        await saveProject(root, { tree: { items: [] }, bible, extraction }, { now: LATER, onWrite: (rel) => writes.push(rel) });
        expect(writes).toEqual(['tree.json', 'bible/bible.json', 'bible/extraction.json', 'vrs.json']);
        expect(await readJson(path.join(root, 'bible', 'extraction.json'))).toEqual(extraction);
    });

    it('open and readStructure return the saved extraction', async () => {
        await saveProject(root, { extraction }, { now: LATER });
        expect((await openProject(root)).extraction).toEqual(extraction);
        expect((await readStructure(root)).extraction).toEqual(extraction);
    });

    it('rejects a corrupt extraction.json', async () => {
        await fs.writeFile(path.join(root, 'bible', 'extraction.json'), '{"pending": 3}');
        await expect(openProject(root)).rejects.toMatchObject({ code: 'CORRUPT' });
    });
});
