import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { readTextImport } from './textImport.js';

let dir: string;
beforeEach(async () => { dir = await fs.mkdtemp(path.join(os.tmpdir(), 'vrs-textimport-')); });
afterEach(async () => { await fs.rm(dir, { recursive: true, force: true }); });

describe('readTextImport', () => {
    it('strips the BOM, normalises line endings and names the import after the file', async () => {
        const p = path.join(dir, 'Chat one.txt');
        await fs.writeFile(p, '\uFEFFa\r\nb\r\n', 'utf8');
        await expect(readTextImport(p)).resolves.toEqual({ title: 'Chat one', text: 'a\nb\n', fileName: 'Chat one.txt' });
    });

    it('refuses unsupported extensions', async () => {
        const p = path.join(dir, 'x.pdf');
        await fs.writeFile(p, 'x');
        await expect(readTextImport(p)).rejects.toMatchObject({ code: 'UNSUPPORTED' });
    });

    it('refuses files over the limit', async () => {
        const p = path.join(dir, 'big.md');
        await fs.writeFile(p, 'hello world');
        await expect(readTextImport(p, { maxBytes: 4 })).rejects.toMatchObject({ code: 'TOO_LARGE' });
    });
});
