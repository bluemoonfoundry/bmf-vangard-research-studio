import fs from 'fs/promises';
import path from 'path';
import { atomicWriteFile } from './atomicFileWrite.js';

/** @typedef {'gemini' | 'anthropic' | 'openai'} ProviderId */
/**
 * @typedef {object} AppSettings
 * @property {{ enabled: boolean, defaultProvider: ProviderId | null, defaultModel: string | null,
 *   providers: Record<ProviderId, { lastTestOk: string | null }> } & Record<string, unknown>} ai
 */

export const PROVIDER_IDS = ['gemini', 'anthropic', 'openai'];

function isObject(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Fills in defaults around whatever was stored, keeping unknown fields. */
function normalize(raw) {
    const base = isObject(raw) ? raw : {};
    const ai = isObject(base.ai) ? base.ai : {};
    const providers = isObject(ai.providers) ? ai.providers : {};
    const merged = {};
    for (const id of PROVIDER_IDS) {
        const p = isObject(providers[id]) ? providers[id] : {};
        merged[id] = { ...p, lastTestOk: typeof p.lastTestOk === 'string' ? p.lastTestOk : null };
    }
    return {
        ...base,
        ai: {
            ...ai,
            enabled: ai.enabled === true,
            defaultProvider: PROVIDER_IDS.includes(ai.defaultProvider) ? ai.defaultProvider : null,
            defaultModel: typeof ai.defaultModel === 'string' ? ai.defaultModel : null,
            providers: { ...providers, ...merged },
        },
    };
}

/**
 * App-level settings in userData (`app-settings.json`). A missing or corrupt
 * file reads as defaults; unknown fields survive an update.
 * @param {string} filePath
 */
export function createAppSettings(filePath) {
    async function read() {
        try {
            return normalize(JSON.parse(await fs.readFile(filePath, 'utf-8')));
        } catch (err) {
            // Only a missing or corrupt file reads as defaults; other errors must not lead to an overwrite.
            if (err instanceof SyntaxError || (err && err.code === 'ENOENT')) return normalize(null);
            throw err;
        }
    }

    // Serialises read-modify-write so concurrent updates cannot drop each other.
    let queue = Promise.resolve();

    return {
        read,

        /** @param {(s: AppSettings) => AppSettings} fn */
        update(fn) {
            const run = queue.then(async () => {
                const next = normalize(fn(await read()));
                await fs.mkdir(path.dirname(filePath), { recursive: true });
                await atomicWriteFile(filePath, `${JSON.stringify(next, null, 2)}\n`);
                return next;
            });
            queue = run.catch(() => undefined);
            return run;
        },
    };
}
