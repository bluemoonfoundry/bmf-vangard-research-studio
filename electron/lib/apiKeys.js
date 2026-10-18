import fs from 'fs/promises';
import path from 'path';
import { atomicWriteFile } from './atomicFileWrite.js';
import { PROVIDER_IDS } from './appSettings.js';

function fail(code, message) {
    return Object.assign(new Error(message), { code });
}

/**
 * Encrypted API keys in userData. Each value is base64 of
 * `safeStorage.encryptString(key)`; plain keys never touch disk.
 * @param {string} filePath
 * @param {{ isEncryptionAvailable(): boolean, encryptString(s: string): Buffer, decryptString(b: Buffer): string }} safeStorage
 */
export function createApiKeyStore(filePath, safeStorage) {
    async function load() {
        try {
            const parsed = JSON.parse(await fs.readFile(filePath, 'utf-8'));
            return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? parsed : {};
        } catch {
            return {};
        }
    }

    async function store(entries) {
        await fs.mkdir(path.dirname(filePath), { recursive: true });
        await atomicWriteFile(filePath, `${JSON.stringify(entries, null, 2)}\n`);
    }

    function check(provider) {
        if (!PROVIDER_IDS.includes(provider)) throw fail('INVALID', 'Unknown provider.');
    }

    let queue = Promise.resolve();
    function serialise(fn) {
        const run = queue.then(fn);
        queue = run.catch(() => undefined);
        return run;
    }

    return {
        available() {
            return safeStorage.isEncryptionAvailable();
        },

        async has(provider) {
            return typeof (await load())[provider] === 'string' && PROVIDER_IDS.includes(provider);
        },

        async get(provider) {
            if (!PROVIDER_IDS.includes(provider)) return null;
            const stored = (await load())[provider];
            if (typeof stored !== 'string') return null;
            try {
                return safeStorage.decryptString(Buffer.from(stored, 'base64'));
            } catch {
                return null;
            }
        },

        async set(provider, key) {
            check(provider);
            const trimmed = typeof key === 'string' ? key.trim() : '';
            if (!trimmed) throw fail('INVALID', 'The API key is empty.');
            if (!safeStorage.isEncryptionAvailable()) {
                throw fail('UNAVAILABLE', 'Secure key storage is not available on this system.');
            }
            await serialise(async () => {
                const entries = await load();
                entries[provider] = safeStorage.encryptString(trimmed).toString('base64');
                await store(entries);
            });
        },

        async remove(provider) {
            check(provider);
            await serialise(async () => {
                const entries = await load();
                delete entries[provider];
                await store(entries);
            });
        },
    };
}
