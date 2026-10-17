import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { createRecentProjects } from './recentProjects.js';

let tmp: string;
let file: string;
let projectA: string;
let projectB: string;

beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'vrs-recent-'));
    file = path.join(tmp, 'recent-projects.json');
    projectA = path.join(tmp, 'A.vrs');
    projectB = path.join(tmp, 'B.vrs');
    await fs.mkdir(projectA);
    await fs.mkdir(projectB);
});

afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true });
});

describe('recentProjects', () => {
    it('starts empty when no file exists', async () => {
        expect(await createRecentProjects(file).list()).toEqual([]);
    });

    it('lists most recently opened first and persists across instances', async () => {
        const recents = createRecentProjects(file, { now: () => 'T1' });
        await recents.add({ root: projectA, name: 'A' });
        await recents.add({ root: projectB, name: 'B' });
        const listed = await createRecentProjects(file).list();
        expect(listed.map(r => r.name)).toEqual(['B', 'A']);
        expect(listed[0]).toEqual({ root: projectB, name: 'B', openedAt: 'T1', missing: false });
    });

    it('moves a reopened project to the top instead of duplicating it', async () => {
        const recents = createRecentProjects(file);
        await recents.add({ root: projectA, name: 'A' });
        await recents.add({ root: projectB, name: 'B' });
        await recents.add({ root: projectA, name: 'A renamed' });
        expect((await recents.list()).map(r => r.name)).toEqual(['A renamed', 'B']);
    });

    it('caps the list length', async () => {
        const recents = createRecentProjects(file, { max: 2 });
        for (const name of ['1', '2', '3']) {
            const root = path.join(tmp, name);
            await fs.mkdir(root);
            await recents.add({ root, name });
        }
        expect((await recents.list()).map(r => r.name)).toEqual(['3', '2']);
    });

    it('flags projects whose folder has disappeared', async () => {
        const recents = createRecentProjects(file);
        await recents.add({ root: projectA, name: 'A' });
        await fs.rm(projectA, { recursive: true });
        expect((await recents.list())[0].missing).toBe(true);
    });

    it('removes and checks membership', async () => {
        const recents = createRecentProjects(file);
        await recents.add({ root: projectA, name: 'A' });
        expect(await recents.has(projectA)).toBe(true);
        expect(await recents.has(path.join(projectA, '..', 'A.vrs'))).toBe(true);
        expect(await recents.has(projectB)).toBe(false);
        await recents.remove(projectA);
        expect(await recents.has(projectA)).toBe(false);
    });

    it.runIf(process.platform === 'win32')('matches paths case-insensitively on Windows', async () => {
        const recents = createRecentProjects(file);
        await recents.add({ root: projectA, name: 'A' });
        expect(await recents.has(projectA.toUpperCase())).toBe(true);
    });

    it('recovers from a corrupt file', async () => {
        await fs.writeFile(file, 'not json');
        const recents = createRecentProjects(file);
        expect(await recents.list()).toEqual([]);
        await recents.add({ root: projectA, name: 'A' });
        expect((await recents.list()).length).toBe(1);
    });

    it('drops malformed entries', async () => {
        await fs.writeFile(file, JSON.stringify([{ root: 5 }, { root: projectA, name: 'A', openedAt: 'T' }, 'x']));
        expect((await createRecentProjects(file).list()).map(r => r.name)).toEqual(['A']);
    });
});
