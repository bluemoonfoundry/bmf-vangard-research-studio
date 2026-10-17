import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { createRecoveryStore } from './recoveryStore.js';

let tmp: string;
let dir: string;
const rootA = path.resolve('/projects/A.vrs');
const rootB = path.resolve('/projects/B.vrs');
const snapshot = { manifest: { name: 'A' }, tree: { items: [] }, docs: { a: 'unsaved text' } };

beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'vrs-recovery-'));
    dir = path.join(tmp, 'recovery');
});

afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true });
});

describe('recoveryStore', () => {
    it('returns null when there is nothing to recover', async () => {
        expect(await createRecoveryStore(dir).read(rootA)).toBeNull();
    });

    it('round-trips a snapshot per project', async () => {
        const store = createRecoveryStore(dir, { now: () => 'T1' });
        await store.write(rootA, snapshot);
        expect(await store.read(rootA)).toEqual({ savedAt: 'T1', ...snapshot });
        expect(await store.read(rootB)).toBeNull();
    });

    it('round-trips a bible in a snapshot', async () => {
        const bible = {
            facts: [{ id: 'f1', entityId: 'e1', attribute: 'hair', value: 'red', status: 'proposed' }],
            dependencies: [],
            decisions: [],
        };
        const store = createRecoveryStore(dir, { now: () => 'T1' });
        await store.write(rootA, { ...snapshot, bible });
        expect((await store.read(rootA))?.bible).toEqual(bible);
    });

    it('keeps only the latest snapshot', async () => {
        const store = createRecoveryStore(dir);
        await store.write(rootA, snapshot);
        await store.write(rootA, { docs: { a: 'newer' } });
        expect((await store.read(rootA))?.docs).toEqual({ a: 'newer' });
        expect(await fs.readdir(dir)).toHaveLength(1);
    });

    it('clears a snapshot, and tolerates clearing one that does not exist', async () => {
        const store = createRecoveryStore(dir);
        await store.write(rootA, snapshot);
        await store.clear(rootA);
        await store.clear(rootB);
        expect(await store.read(rootA)).toBeNull();
    });

    it('validates snapshots like a save', async () => {
        await expect(createRecoveryStore(dir).write(rootA, { docs: { '../x': 'a' } }))
            .rejects.toMatchObject({ code: 'INVALID' });
    });

    it('ignores a corrupt snapshot file', async () => {
        const store = createRecoveryStore(dir);
        await store.write(rootA, snapshot);
        const [name] = await fs.readdir(dir);
        await fs.writeFile(path.join(dir, name), '{oops');
        expect(await store.read(rootA)).toBeNull();
    });

    it('ignores a snapshot recorded for a different root (hash collision guard)', async () => {
        const store = createRecoveryStore(dir);
        await store.write(rootA, snapshot);
        const [name] = await fs.readdir(dir);
        const file = path.join(dir, name);
        const stored = JSON.parse(await fs.readFile(file, 'utf-8'));
        await fs.writeFile(file, JSON.stringify({ ...stored, root: rootB }));
        expect(await store.read(rootA)).toBeNull();
    });
});
