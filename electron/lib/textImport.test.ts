import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { readTextImport, readTextImports } from './textImport.js';

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
    it('accepts an extensionless text file and titles it with the whole name', async () => {
        const p = path.join(dir, 'Among the Clouds');
        await fs.writeFile(p, '{"a":1}');
        await expect(readTextImport(p)).resolves.toMatchObject({ title: 'Among the Clouds', fileName: 'Among the Clouds' });
    });

    it('refuses an extensionless binary file', async () => {
        const p = path.join(dir, 'picture');
        await fs.writeFile(p, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01]));
        await expect(readTextImport(p)).rejects.toMatchObject({ code: 'UNSUPPORTED', message: 'picture is not a text file.' });
    });

    it('refuses an extensionless file that is not valid UTF-8', async () => {
        const p = path.join(dir, 'latin1');
        await fs.writeFile(p, Buffer.from([0x63, 0x61, 0x66, 0xe9]));
        await expect(readTextImport(p)).rejects.toMatchObject({ code: 'UNSUPPORTED' });
    });
});

describe('readTextImports', () => {
    it('imports what it can and reports the rest', async () => {
        const good = path.join(dir, 'a.md');
        await fs.writeFile(good, 'hi');
        const bad = path.join(dir, 'b.pdf');
        await fs.writeFile(bad, 'x');
        const r = await readTextImports([good, bad]);
        expect(r.imports.map(i => i.fileName)).toEqual(['a.md']);
        expect(r.skipped).toEqual([{ fileName: 'b.pdf', message: expect.stringMatching(/not a supported/) }]);
    });
});
