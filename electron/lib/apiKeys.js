import fs from 'fs/promises';
import path from 'path';
import { atomicWriteFile } from './atomicFileWrite.js';
import { PROVIDER_IDS } from './appSettings.js';
import { logger } from './logger.main.js';

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
    /** Missing file is empty; any other failure throws so a write cannot clobber stored keys. */
    async function load() {
        let text;
        try {
            text = await fs.readFile(filePath, 'utf-8');
        } catch (err) {
            if (err && err.code === 'ENOENT') return {};
            throw fail('UNAVAILABLE', 'The key store could not be read.');
        }
        let parsed;
        try {
            parsed = JSON.parse(text);
        } catch {
            throw fail('CORRUPT', 'The key store is corrupt.');
        }
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
            throw fail('CORRUPT', 'The key store is corrupt.');
        }
        return parsed;
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
            if (!PROVIDER_IDS.includes(provider)) return false;
            return typeof (await load())[provider] === 'string';
        },

        async get(provider) {
            if (!PROVIDER_IDS.includes(provider)) return null;
            const stored = (await load())[provider];
            if (typeof stored !== 'string') return null;
            try {
                return safeStorage.decryptString(Buffer.from(stored, 'base64'));
            } catch {
                logger.warn(`Stored API key for ${provider} could not be decrypted.`);
                throw fail('UNAVAILABLE', `The stored API key for ${provider} can't be decrypted; save it again.`);
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
