import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { createApiKeyStore } from './apiKeys.js';

vi.mock('./logger.main.js', () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() } }));

let tmp: string;
let file: string;

const safeStorage = {
    isEncryptionAvailable: () => true,
    encryptString: (s: string) => Buffer.from('enc:' + s),
    decryptString: (b: Buffer) => b.toString().slice(4),
};

beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'vrs-keys-'));
    file = path.join(tmp, 'api-keys.json');
});

afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true });
});

describe('apiKeys', () => {
    it('round-trips a key', async () => {
        const keys = createApiKeyStore(file, safeStorage);
        expect(await keys.has('openai')).toBe(false);
        expect(await keys.get('openai')).toBeNull();
        await keys.set('openai', 'sk-1');
        expect(await keys.has('openai')).toBe(true);
        expect(await createApiKeyStore(file, safeStorage).get('openai')).toBe('sk-1');
    });

    it('trims pasted keys', async () => {
        const keys = createApiKeyStore(file, safeStorage);
        await keys.set('anthropic', '  sk-1\n');
        expect(await keys.get('anthropic')).toBe('sk-1');
    });

    it('file never contains the plain key', async () => {
        await createApiKeyStore(file, safeStorage).set('gemini', 'sk-1');
        const raw = await fs.readFile(file, 'utf-8');
        expect(raw).not.toContain('sk-1');
    });

    it('refuses when encryption is unavailable', async () => {
        const keys = createApiKeyStore(file, { ...safeStorage, isEncryptionAvailable: () => false });
        expect(keys.available()).toBe(false);
        await expect(keys.set('gemini', 'sk-1')).rejects.toMatchObject({ code: 'UNAVAILABLE' });
    });

    it('remove deletes only that provider', async () => {
        const keys = createApiKeyStore(file, safeStorage);
        await keys.set('gemini', 'a');
        await keys.set('openai', 'b');
        await keys.remove('gemini');
        expect(await keys.has('gemini')).toBe(false);
        expect(await keys.get('openai')).toBe('b');
    });

    it('rejects unknown provider and empty key', async () => {
        const keys = createApiKeyStore(file, safeStorage);
        await expect(keys.set('bogus', 'x')).rejects.toMatchObject({ code: 'INVALID' });
        await expect(keys.set('openai', '   ')).rejects.toMatchObject({ code: 'INVALID' });
    });

    it('refuses to overwrite a corrupt key file', async () => {
        const keys = createApiKeyStore(file, safeStorage);
        await keys.set('gemini', 'a');
        await fs.writeFile(file, '{ corrupt', 'utf-8');
        await expect(keys.set('openai', 'b')).rejects.toMatchObject({ code: 'CORRUPT' });
        await expect(keys.remove('gemini')).rejects.toMatchObject({ code: 'CORRUPT' });
        expect(await fs.readFile(file, 'utf-8')).toBe('{ corrupt');
    });

    it('reset moves a corrupt key file aside and starts fresh', async () => {
        const keys = createApiKeyStore(file, safeStorage);
        await fs.writeFile(file, '{ corrupt', 'utf-8');
        const backup = await keys.reset('2026-10-18T09-30-00-000Z');
        expect(backup).toBe(`${file}.corrupt-2026-10-18T09-30-00-000Z`);
        expect(await fs.readFile(backup!, 'utf-8')).toBe('{ corrupt');
        expect(await keys.has('openai')).toBe(false);
        await keys.set('openai', 'b');
        expect(await keys.get('openai')).toBe('b');
    });

    it('reset with no key file does nothing', async () => {
        const keys = createApiKeyStore(file, safeStorage);
        expect(await keys.reset('stamp')).toBeNull();
        expect(await fs.readdir(tmp)).toEqual([]);
    });

    it('reset refuses a key file that reads fine', async () => {
        const keys = createApiKeyStore(file, safeStorage);
        await keys.set('gemini', 'a');
        await expect(keys.reset('stamp')).rejects.toMatchObject({ code: 'INVALID' });
        expect(await keys.get('gemini')).toBe('a');
    });

    it('reset rejects a stamp that is not a plain file-name part', async () => {
        const keys = createApiKeyStore(file, safeStorage);
        await fs.writeFile(file, '{ corrupt', 'utf-8');
        await expect(keys.reset('../x')).rejects.toMatchObject({ code: 'INVALID' });
        expect(await fs.readFile(file, 'utf-8')).toBe('{ corrupt');
    });

    it('rejects on a non-ENOENT read error', async () => {
        await fs.mkdir(file); // reading a directory fails with EISDIR
        const keys = createApiKeyStore(file, safeStorage);
        await expect(keys.set('openai', 'b')).rejects.toMatchObject({ code: 'UNAVAILABLE' });
        await expect(keys.get('openai')).rejects.toMatchObject({ code: 'UNAVAILABLE' });
    });

    it('reset moves an unreadable key store aside too', async () => {
        await fs.mkdir(file);
        const keys = createApiKeyStore(file, safeStorage);
        const backup = await keys.reset('stamp');
        expect((await fs.stat(backup!)).isDirectory()).toBe(true);
        expect(await keys.has('openai')).toBe(false);
    });

    it('throws a coded error when a stored key cannot be decrypted', async () => {
        const keys = createApiKeyStore(file, safeStorage);
        await keys.set('openai', 'sk-1');
        const broken = createApiKeyStore(file, { ...safeStorage, decryptString: () => { throw new Error('bad'); } });
        expect(await broken.has('openai')).toBe(true);
        const err = await broken.get('openai').catch((e: Error) => e) as Error & { code: string };
        expect(err.code).toBe('UNAVAILABLE');
        expect(err.message).toContain("can't be decrypted");
        expect(err.message).not.toContain('sk-1');
    });
});
