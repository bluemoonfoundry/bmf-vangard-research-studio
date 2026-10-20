import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { createProjectSession, toIpcResult } from './projectSession.js';
import { createRecentProjects } from './recentProjects.js';
import { createRecoveryStore } from './recoveryStore.js';
import { createProject } from './projectStore.js';

let tmp: string;
let watchers: { root: string; noteWrite: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn>; onChange: (c: unknown) => void }[];
let onExternalChange: ReturnType<typeof vi.fn<(changes: unknown) => void>>;
let recents: ReturnType<typeof createRecentProjects>;
let recovery: ReturnType<typeof createRecoveryStore>;

function makeSession() {
    let n = 0;
    return createProjectSession({
        recents,
        recovery,
        onExternalChange,
        now: () => '2026-10-17T12:00:00.000Z',
        newId: () => `id${++n}`,
        watcherFactory: (root: string, { onChange }: { onChange: (c: unknown) => void }) => {
            const w = { root, noteWrite: vi.fn(), close: vi.fn(), onChange };
            watchers.push(w);
            return w;
        },
    });
}

beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'vrs-session-'));
    watchers = [];
    onExternalChange = vi.fn<(changes: unknown) => void>();
    recents = createRecentProjects(path.join(tmp, 'userData', 'recent.json'));
    recovery = createRecoveryStore(path.join(tmp, 'userData', 'recovery'));
});

afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true });
});

describe('projectSession', () => {
    it('creates a project named after its folder and records it as recent', async () => {
        const session = makeSession();
        const root = path.join(tmp, 'Dragon Saga.vrs');
        const opened = await session.create(root);
        expect(opened).toMatchObject({ root, manifest: { name: 'Dragon Saga', id: 'id1' }, migratedFrom: null, recovery: null });
        expect(session.root).toBe(root);
        expect((await recents.list())[0]).toMatchObject({ root, name: 'Dragon Saga' });
    });

    it('opens a project, starts watching it, and forwards external changes', async () => {
        const root = path.join(tmp, 'A.vrs');
        await createProject(root, { id: 'p', name: 'A', now: 'T' });
        const session = makeSession();
        await session.open(root);
        expect(watchers).toHaveLength(1);
        watchers[0].onChange([{ path: 'docs/x.md', deleted: false }]);
        expect(onExternalChange).toHaveBeenCalledWith([{ path: 'docs/x.md', deleted: false }]);
    });

    it('switching projects stops watching the previous one', async () => {
        const session = makeSession();
        await session.create(path.join(tmp, 'A.vrs'));
        await session.create(path.join(tmp, 'B.vrs'));
        expect(watchers[0].close).toHaveBeenCalled();
        expect(session.root).toBe(path.join(tmp, 'B.vrs'));
    });

    it('keeps the current project open when opening another one fails', async () => {
        const session = makeSession();
        const a = path.join(tmp, 'A.vrs');
        await session.create(a);
        await fs.mkdir(path.join(tmp, 'empty'));
        await expect(session.open(path.join(tmp, 'empty'))).rejects.toMatchObject({ code: 'NOT_A_PROJECT' });
        expect(session.root).toBe(a);
        expect(watchers[0].close).not.toHaveBeenCalled();
    });

    it('only reopens roots that are in the recent list', async () => {
        const root = path.join(tmp, 'A.vrs');
        await createProject(root, { id: 'p', name: 'A', now: 'T' });
        const session = makeSession();
        await expect(session.openRecent(root)).rejects.toMatchObject({ code: 'NOT_RECENT' });
        await recents.add({ root, name: 'A' });
        await expect(session.openRecent(root)).resolves.toMatchObject({ root });
    });

    it('refuses project operations when nothing is open', async () => {
        const session = makeSession();
        await expect(session.readDoc('a')).rejects.toMatchObject({ code: 'NO_PROJECT' });
        await expect(session.readChat('a')).rejects.toMatchObject({ code: 'NO_PROJECT' });
        await expect(session.save({})).rejects.toMatchObject({ code: 'NO_PROJECT' });
        await expect(session.writeRecovery({})).rejects.toMatchObject({ code: 'NO_PROJECT' });
    });

    it('saves through the watcher so its own writes are not reported back', async () => {
        const session = makeSession();
        const root = path.join(tmp, 'A.vrs');
        await session.create(root);
        await session.save({ tree: { items: [{ id: 'a', parentId: null, type: 'document', title: 'A', order: 0 }] }, docs: { a: 'Body' } });
        expect(await session.readDoc('a')).toBe('Body');
        expect(watchers[0].noteWrite).toHaveBeenCalledWith('docs/a.md', 'Body');
    });

    it('updates the recent entry when the project is renamed', async () => {
        const session = makeSession();
        await session.create(path.join(tmp, 'A.vrs'));
        await session.save({ manifest: { name: 'Renamed' } });
        expect((await recents.list())[0].name).toBe('Renamed');
    });

    it('offers recovery on open and clears it on save', async () => {
        const root = path.join(tmp, 'A.vrs');
        const session = makeSession();
        await session.create(root);
        await session.writeRecovery({ docs: { a: 'unsaved' } });

        const reopened = await makeSession().open(root);
        expect(reopened.recovery).toMatchObject({ docs: { a: 'unsaved' } });

        await session.save({ docs: { a: 'unsaved' } });
        expect(await recovery.read(root)).toBeNull();
    });

    it('discards recovery on request and on a clean close', async () => {
        const root = path.join(tmp, 'A.vrs');
        const session = makeSession();
        await session.create(root);
        await session.writeRecovery({ docs: { a: 'x' } });
        await session.discardRecovery();
        expect(await recovery.read(root)).toBeNull();

        await session.writeRecovery({ docs: { a: 'x' } });
        await session.close({ discardRecovery: true });
        expect(await recovery.read(root)).toBeNull();
        expect(session.root).toBeNull();
    });

    it('keeps recovery when closed without discarding (e.g. a crash-like quit)', async () => {
        const root = path.join(tmp, 'A.vrs');
        const session = makeSession();
        await session.create(root);
        await session.writeRecovery({ docs: { a: 'x' } });
        await session.close();
        expect(await recovery.read(root)).not.toBeNull();
    });
});

describe('projectSession assets', () => {
    it('imports media into the open project and reads it back', async () => {
        const root = path.join(tmp, 'A.vrs');
        await createProject(root, { id: 'p', name: 'A', now: 'T' });
        const source = path.join(tmp, 'tape.wav');
        await fs.writeFile(source, 'RIFF');
        const session = makeSession();
        await session.open(root);

        const imported = await session.importAsset(source, 'audio');
        expect(imported).toEqual({ asset: 'id1.wav', originalName: 'tape', bytes: 4 });
        expect(await session.checkAsset('id1.wav')).toEqual({ bytes: 4 });
        expect((await fs.readFile(await session.assetPath('id1.wav'))).toString()).toBe('RIFF');
    });

    it('refuses asset operations when nothing is open', async () => {
        const session = makeSession();
        await expect(session.checkAsset('a.png')).rejects.toMatchObject({ code: 'NO_PROJECT' });
        await expect(session.assetPath('a.png')).rejects.toMatchObject({ code: 'NO_PROJECT' });
        await expect(session.importAsset('/x.png', 'image')).rejects.toMatchObject({ code: 'NO_PROJECT' });
    });
});

describe('toIpcResult', () => {
    it('wraps values and errors in a serialisable envelope', async () => {
        expect(await toIpcResult(async () => 5)).toEqual({ ok: true, value: 5 });
        const coded = Object.assign(new Error('nope'), { code: 'NOT_A_PROJECT' });
        expect(await toIpcResult(async () => { throw coded; })).toEqual({ ok: false, error: { code: 'NOT_A_PROJECT', message: 'nope' } });
        expect(await toIpcResult(async () => { throw new Error('disk'); })).toEqual({ ok: false, error: { code: 'IO', message: 'disk' } });
    });
});
