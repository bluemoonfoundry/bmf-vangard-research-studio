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

    it('treats a dot inside a name as part of the name, not an extension', async () => {
        for (const name of ['Scene 2.1 draft', 'Chapter 3.2', 'Abaddon v1.5b']) {
            const p = path.join(dir, name);
            await fs.writeFile(p, 'Odile keeps the log.');
            await expect(readTextImport(p)).resolves.toMatchObject({ title: name, fileName: name, text: 'Odile keeps the log.' });
        }
    });

    it('still refuses a real unsupported extension, whatever the case', async () => {
        const p = path.join(dir, 'Draft 2.DOCX');
        await fs.writeFile(p, 'x');
        await expect(readTextImport(p)).rejects.toMatchObject({ code: 'UNSUPPORTED', message: 'Draft 2.DOCX is not a supported text file.' });
    });

    it('sniffs a dotted extensionless name like any other', async () => {
        const p = path.join(dir, 'Scene 2.1 art');
        await fs.writeFile(p, Buffer.from([0x89, 0x50, 0x00]));
        await expect(readTextImport(p)).rejects.toMatchObject({ code: 'UNSUPPORTED', message: 'Scene 2.1 art is not a text file.' });
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

describe('readTextImport encodings', () => {
    const utf16 = (text: string, be = false, bom = true) => {
        const le = Buffer.from((bom ? String.fromCharCode(0xfeff) : '') + text, 'utf16le');
        return be ? le.swap16() : le;
    };

    it('decodes UTF-16 LE with a BOM (Notepad "Unicode", PowerShell 5 redirects)', async () => {
        const p = path.join(dir, 'Chat.txt');
        await fs.writeFile(p, utf16('=== You ===\r\nCafé, naïve — ok\r\n'));
        await expect(readTextImport(p)).resolves.toMatchObject({ text: '=== You ===\nCafé, naïve — ok\n' });
    });

    it('decodes UTF-16 BE with a BOM', async () => {
        const p = path.join(dir, 'Chat.md');
        await fs.writeFile(p, utf16('Odile 日本\n', true));
        await expect(readTextImport(p)).resolves.toMatchObject({ text: 'Odile 日本\n' });
    });

    it('decodes BOM-less UTF-16 that is mostly ASCII', async () => {
        const le = path.join(dir, 'le.txt');
        await fs.writeFile(le, utf16('Odile keeps the log.\n', false, false));
        await expect(readTextImport(le)).resolves.toMatchObject({ text: 'Odile keeps the log.\n' });
        const be = path.join(dir, 'be.txt');
        await fs.writeFile(be, utf16('Odile keeps the log.\n', true, false));
        await expect(readTextImport(be)).resolves.toMatchObject({ text: 'Odile keeps the log.\n' });
    });

    it('accepts an extensionless UTF-16 file instead of calling it binary', async () => {
        const p = path.join(dir, 'Among the Clouds');
        await fs.writeFile(p, utf16('{"chunkedPrompt":{"chunks":[]}}'));
        await expect(readTextImport(p)).resolves.toMatchObject({ text: '{"chunkedPrompt":{"chunks":[]}}', title: 'Among the Clouds' });
    });

    it('never leaves NULs or replacement characters from a UTF-16 file', async () => {
        const p = path.join(dir, 'Chat.txt');
        await fs.writeFile(p, utf16('a\nb\n'));
        const { text } = await readTextImport(p);
        expect(text).not.toContain(String.fromCharCode(0));
        expect(text).not.toContain(String.fromCharCode(0xfffd));
    });

    it('still strips a UTF-8 BOM from an extensionless file', async () => {
        const p = path.join(dir, 'bom');
        await fs.writeFile(p, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('hi', 'utf8')]));
        await expect(readTextImport(p)).resolves.toMatchObject({ text: 'hi' });
    });

    it('refuses an extensionless file with a UTF-16 BOM that does not decode', async () => {
        const p = path.join(dir, 'odd');
        // A lone high surrogate after the BOM.
        await fs.writeFile(p, Buffer.from([0xff, 0xfe, 0x00, 0xd8, 0x41, 0x00]));
        await expect(readTextImport(p)).rejects.toMatchObject({ code: 'UNSUPPORTED', message: 'odd is not a text file.' });
    });

    it('refuses an extensionless binary file that happens to start like a UTF-16 BOM', async () => {
        const p = path.join(dir, 'blob');
        await fs.writeFile(p, Buffer.from([0xff, 0xfe, 0x00, 0x00, 0x01, 0x00]));
        await expect(readTextImport(p)).rejects.toMatchObject({ code: 'UNSUPPORTED' });
    });
});

describe('readTextImports', () => {
    it('skips a file it cannot read (missing, locked) and imports the rest', async () => {
        const good = path.join(dir, 'a.md');
        await fs.writeFile(good, 'hi');
        const gone = path.join(dir, 'gone.md');
        const folder = path.join(dir, 'folder.md');
        await fs.mkdir(folder);
        const r = await readTextImports([gone, good, folder]);
        expect(r.imports.map(i => i.fileName)).toEqual(['a.md']);
        expect(r.skipped).toEqual([
            { fileName: 'gone.md', message: "gone.md couldn't be read (ENOENT)." },
            { fileName: 'folder.md', message: "folder.md couldn't be read (EISDIR)." },
        ]);
    });

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
