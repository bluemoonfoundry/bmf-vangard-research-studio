import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { createApiKeyStore } from './apiKeys.js';

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
});
