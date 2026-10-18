import { PROVIDER_IDS } from '../appSettings.js';
import { isValidItemId } from '../projectSchema.js';
import { logger } from '../logger.main.js';
import { LlmError, scrub } from './http.js';
import { EXTRACTION_SCHEMA, parseExtraction } from './extractionSchema.js';

/** @typedef {import('../appSettings.js').ProviderId} ProviderId */
/** @typedef {{ configured: boolean, lastTestOk: string | null }} ProviderStatus */
/**
 * @typedef {object} AiStatus
 * @property {boolean} enabled
 * @property {ProviderId | null} defaultProvider
 * @property {string | null} defaultModel
 * @property {boolean} encryptionAvailable
 * @property {Record<ProviderId, ProviderStatus>} providers
 * @property {string | null} keyStoreProblem  User-facing, key-free; null when the key store reads fine.
 */
/**
 * @typedef {object} ChatRequest
 * @property {ProviderId} provider
 * @property {string} model
 * @property {string} system
 * @property {{ role: 'user' | 'assistant', text: string }[]} messages
 * @property {number} [temperature]
 * @property {boolean} webSearch
 * @property {boolean} readUrls
 */
/**
 * @typedef {object} Adapter
 * @property {ProviderId} id
 * @property {(key: string, signal: AbortSignal) => Promise<any[]>} listModels
 * @property {(modelId: string) => { webSearch: boolean, readUrls: boolean, temperature: boolean }} capabilities
 * @property {(request: ChatRequest, key: string, signal: AbortSignal, onEvent: (e: any) => void) => Promise<void>} stream
 */

/**
 * @typedef {object} ExtractRequest
 * @property {ProviderId} provider
 * @property {string} model
 * @property {string} system
 * @property {string} text  The source text and canon, built by the renderer.
 */
/** @typedef {{ controller: AbortController, finished: boolean, onAbort?: () => void }} ActiveEntry */

/** Total characters of text a single chat request may carry. */
export const MAX_REQUEST_CHARS = 4_000_000;
/** Output budget for an extraction reply (Anthropic needs it stated; every model with structured outputs allows it). */
export const EXTRACT_MAX_OUTPUT_TOKENS = 32_000;
/** How long a key test / model-list call may take. */
const LIST_TIMEOUT_MS = 30_000;

const KEY_STORE_PROBLEM = 'Your saved API keys could not be read. Add your keys again in Settings → AI.';
const CANCELLED_EVENT = Object.freeze({ type: 'error', code: 'CANCELLED', message: 'Cancelled' });
const SETTINGS_FIELDS = ['enabled', 'defaultProvider', 'defaultModel'];

/** @param {string} message @returns {never} */
function invalid(message) {
    throw new LlmError('INVALID', message);
}

/** @param {unknown} value */
function isObject(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** @param {unknown} provider @returns {ProviderId} */
function checkProvider(provider) {
    if (!PROVIDER_IDS.includes(/** @type {any} */ (provider))) invalid('Unknown provider.');
    return /** @type {ProviderId} */ (provider);
}

/**
 * Validates a renderer-supplied chat request and copies only the known fields.
 * @param {unknown} raw
 * @returns {ChatRequest}
 */
function sanitizeRequest(raw) {
    if (!isObject(raw)) invalid('The chat request is malformed.');
    const r = /** @type {Record<string, unknown>} */ (raw);
    const provider = checkProvider(r.provider);
    if (typeof r.model !== 'string' || !r.model) invalid('The chat request has no model.');
    if (typeof r.system !== 'string') invalid('The chat request is malformed.');
    if (typeof r.webSearch !== 'boolean' || typeof r.readUrls !== 'boolean') invalid('The chat request is malformed.');
    if (r.temperature !== undefined && (typeof r.temperature !== 'number' || !Number.isFinite(r.temperature))) {
        invalid('The chat request has an invalid temperature.');
    }
    if (!Array.isArray(r.messages) || r.messages.length === 0) invalid('The chat request has no messages.');
    let total = r.model.length + r.system.length;
    const messages = r.messages.map((m) => {
        if (!isObject(m) || (m.role !== 'user' && m.role !== 'assistant') || typeof m.text !== 'string') {
            invalid('The chat request has a malformed message.');
        }
        total += m.text.length;
        return { role: /** @type {'user' | 'assistant'} */ (m.role), text: m.text };
    });
    if (total > MAX_REQUEST_CHARS) invalid('The chat is too long to send. Remove attachments or start a new chat.');
    /** @type {ChatRequest} */
    const request = { provider, model: r.model, system: r.system, messages, webSearch: r.webSearch, readUrls: r.readUrls };
    if (r.temperature !== undefined) request.temperature = /** @type {number} */ (r.temperature);
    return request;
}

/**
 * Validates a renderer-supplied extraction request.
 * @param {unknown} raw
 * @returns {ExtractRequest}
 */
function sanitizeExtractRequest(raw) {
    if (!isObject(raw)) invalid('The extraction request is malformed.');
    const r = /** @type {Record<string, unknown>} */ (raw);
    const provider = checkProvider(r.provider);
    if (typeof r.model !== 'string' || !r.model) invalid('The extraction request has no model.');
    if (typeof r.system !== 'string' || typeof r.text !== 'string' || !r.text) invalid('The extraction request is malformed.');
    if (r.model.length + r.system.length + r.text.length > MAX_REQUEST_CHARS) invalid('This source is too long to send in one request.');
    return { provider, model: r.model, system: r.system, text: r.text };
}

/**
 * Owns the AI-enabled check, key lookup, model-list cache and the registry of
 * in-flight chat streams. Plain keys only live inside a single call here.
 *
 * `cancelAll()` is the IPC-facing variant (refused while AI is disabled);
 * `abortAll()` is for main-process housekeeping (project close, window closed,
 * disabling AI) and never throws.
 *
 * @param {object} deps
 * @param {{ read(): Promise<any>, update(fn: (s: any) => any): Promise<any> }} deps.settings
 * @param {{ available(): boolean, has(p: string): Promise<boolean>, get(p: string): Promise<string | null>,
 *   set(p: string, k: string): Promise<void>, remove(p: string): Promise<void> }} deps.keys
 * @param {Record<ProviderId, Adapter>} deps.adapters
 * @param {(requestId: string, event: any) => void} deps.emit
 * @param {() => string} [deps.now]  ISO timestamp source.
 */
export function createLlmService({ settings, keys, adapters, emit, now = () => new Date().toISOString() }) {
    /** @type {Map<ProviderId, any[]>} */
    const modelCache = new Map();
    /** Chat streams and extractions in flight, by request id. @type {Map<string, ActiveEntry>} */
    const active = new Map();
    /** Bumped by every abortAll(), so a chat that was still starting when it ran can tell. */
    let abortEpoch = 0;

    async function requireEnabled() {
        const s = await settings.read();
        if (!s.ai.enabled) throw new LlmError('AI_DISABLED', 'AI is turned off. Enable it in Settings → AI.');
    }

    /** @param {ProviderId} provider */
    async function requireKey(provider) {
        const key = await keys.get(provider);
        if (!key) invalid(`No API key is saved for ${provider}.`);
        return key;
    }

    /** Runs the provider's model-list call as a key test; errors are scrubbed of the key. */
    async function fetchModels(/** @type {ProviderId} */ provider, /** @type {string} */ key) {
        try {
            return await adapters[provider].listModels(key, globalThis.AbortSignal.timeout(LIST_TIMEOUT_MS));
        } catch (err) {
            const e = /** @type {any} */ (err);
            const code = err instanceof LlmError ? e.code : 'PROVIDER';
            throw new LlmError(code, scrub(e && e.message ? e.message : 'The provider could not be reached.', [key]));
        }
    }

    /** @param {ProviderId} provider @param {string | null} lastTestOk */
    function recordTest(provider, lastTestOk) {
        return settings.update((s) => ({
            ...s,
            ai: { ...s.ai, providers: { ...s.ai.providers, [provider]: { ...s.ai.providers[provider], lastTestOk } } },
        }));
    }

    /** @returns {Promise<AiStatus>} */
    async function getStatus() {
        const s = await settings.read();
        /** @type {Record<string, boolean>} */
        const configured = {};
        let keyStoreProblem = null;
        try {
            for (const id of PROVIDER_IDS) configured[id] = await keys.has(id);
        } catch (err) {
            logger.warn('The API key store could not be read', /** @type {any} */ (err)?.code);
            for (const id of PROVIDER_IDS) configured[id] = false;
            keyStoreProblem = KEY_STORE_PROBLEM;
        }
        /** @type {Record<string, ProviderStatus>} */
        const providers = {};
        for (const id of PROVIDER_IDS) {
            providers[id] = { configured: configured[id], lastTestOk: configured[id] ? s.ai.providers[id].lastTestOk : null };
        }
        return {
            enabled: s.ai.enabled,
            defaultProvider: s.ai.defaultProvider,
            defaultModel: s.ai.defaultModel,
            encryptionAvailable: keys.available(),
            providers: /** @type {Record<ProviderId, ProviderStatus>} */ (providers),
            keyStoreProblem,
        };
    }

    /** Ends one stream with a CANCELLED event (an extraction: a CANCELLED rejection), at most once. */
    function abortOne(/** @type {string} */ requestId) {
        const entry = active.get(requestId);
        if (!entry) return;
        active.delete(requestId);
        entry.finished = true;
        entry.controller.abort();
        if (entry.onAbort) entry.onAbort();
        else emit(requestId, CANCELLED_EVENT);
    }

    function abortAll() {
        abortEpoch += 1;
        for (const requestId of [...active.keys()]) {
            try {
                abortOne(requestId);
            } catch (err) {
                logger.warn('Cancelling a chat failed', err);
            }
        }
    }

    /**
     * @param {string} requestId
     * @param {ChatRequest} request
     * @param {string} key
     * @param {ActiveEntry} entry
     */
    async function runStream(requestId, request, key, entry) {
        let sawDone = false;
        try {
            await adapters[request.provider].stream(request, key, entry.controller.signal, (event) => {
                if (entry.finished) return;
                if (event && event.type === 'done') sawDone = true;
                emit(requestId, event);
            });
            if (!sawDone && !entry.finished) {
                emit(requestId, { type: 'error', code: 'PROVIDER', message: 'The reply ended unexpectedly.' });
            }
        } catch (err) {
            if (entry.finished) return;
            const e = /** @type {any} */ (err);
            if (!(err instanceof LlmError)) logger.warn('Chat stream failed unexpectedly', scrub(String(e?.message ?? e), [key]));
            const code = err instanceof LlmError ? e.code : 'PROVIDER';
            const message = scrub(e && e.message ? e.message : 'The provider reported an error.', [key]);
            emit(requestId, { type: 'error', code, message });
        } finally {
            entry.finished = true;
            if (active.get(requestId) === entry) active.delete(requestId);
        }
    }

    /**
     * Streams an extraction request and collects the reply text. Rejects CANCELLED as soon as the
     * entry is aborted, whether or not the adapter notices.
     * @param {ExtractRequest} request
     * @param {string} key
     * @param {ActiveEntry} entry
     */
    function collectReply(request, key, entry) {
        const cancelled = new Promise((_resolve, reject) => {
            entry.onAbort = () => reject(new LlmError('CANCELLED', 'Cancelled'));
        });
        const streamed = (async () => {
            let text = '';
            /** @type {any} */
            let done = null;
            /** @type {any} */
            let failed = null;
            await adapters[request.provider].stream({
                provider: request.provider, model: request.model, system: request.system,
                messages: [{ role: 'user', text: request.text }],
                webSearch: false, readUrls: false,
                jsonSchema: EXTRACTION_SCHEMA, maxOutputTokens: EXTRACT_MAX_OUTPUT_TOKENS,
            }, key, entry.controller.signal, (event) => {
                if (!event || failed) return;
                if (event.type === 'text') text += event.delta;
                else if (event.type === 'done') done = event;
                else if (event.type === 'error') failed = event;
            });
            if (failed) throw new LlmError(failed.code, String(failed.message ?? 'The provider reported an error.'));
            if (!done) throw new LlmError('PROVIDER', 'The reply ended unexpectedly.');
            return { ...parseExtraction(text), model: done.model, ...(done.usage && { usage: done.usage }) };
        })();
        // The losing promise must not surface as an unhandled rejection.
        streamed.catch(() => {});
        cancelled.catch(() => {});
        return Promise.race([streamed, cancelled]);
    }

    return {
        getStatus,
        abortAll,

        /** @param {unknown} patch */
        async setSettings(patch) {
            if (!isObject(patch)) invalid('Settings must be an object.');
            const p = /** @type {Record<string, unknown>} */ (patch);
            for (const field of Object.keys(p)) {
                if (!SETTINGS_FIELDS.includes(field)) invalid(`Unknown AI setting "${field}".`);
            }
            if ('enabled' in p && typeof p.enabled !== 'boolean') invalid('"enabled" must be true or false.');
            if ('defaultProvider' in p && p.defaultProvider !== null) checkProvider(p.defaultProvider);
            if ('defaultModel' in p && p.defaultModel !== null && (typeof p.defaultModel !== 'string' || !p.defaultModel)) {
                invalid('"defaultModel" must be a model id or null.');
            }
            if (p.enabled === true) {
                const s = await settings.read();
                let ready = false;
                for (const id of PROVIDER_IDS) {
                    if (s.ai.providers[id].lastTestOk && await keys.has(id)) ready = true;
                }
                if (!ready) invalid('Add an API key that passes its test before turning AI on.');
            }
            await settings.update((s) => ({ ...s, ai: { ...s.ai, ...p } }));
            if (p.enabled === false) abortAll();
            return getStatus();
        },

        /** Tests the key with a model-list call and stores it only if that succeeds. */
        async saveKey(/** @type {unknown} */ provider, /** @type {unknown} */ key) {
            const id = checkProvider(provider);
            const trimmed = typeof key === 'string' ? key.trim() : '';
            if (!trimmed) invalid('The API key is empty.');
            if (!keys.available()) throw new LlmError('UNAVAILABLE', 'Secure key storage is not available on this system.');
            const models = await fetchModels(id, trimmed);
            await keys.set(id, trimmed);
            modelCache.set(id, models);
            await recordTest(id, now());
            return getStatus();
        },

        /** Removes the key; removing the last configured one also turns AI off. */
        async removeKey(/** @type {unknown} */ provider) {
            const id = checkProvider(provider);
            await keys.remove(id);
            modelCache.delete(id);
            await recordTest(id, null);
            let anyLeft = false;
            for (const other of PROVIDER_IDS) {
                if (await keys.has(other)) anyLeft = true;
            }
            if (!anyLeft) {
                await settings.update((s) => ({ ...s, ai: { ...s.ai, enabled: false } }));
                abortAll();
            }
            return getStatus();
        },

        /** Re-tests a stored key; a failure clears its last-test time and rethrows. */
        async testKey(/** @type {unknown} */ provider) {
            const id = checkProvider(provider);
            const key = await requireKey(id);
            let models;
            try {
                models = await fetchModels(id, key);
            } catch (err) {
                await recordTest(id, null);
                throw err;
            }
            modelCache.set(id, models);
            await recordTest(id, now());
            return getStatus();
        },

        /** @param {unknown} provider @param {{ refresh?: boolean }} [options] */
        async listModels(provider, options) {
            await requireEnabled();
            const id = checkProvider(provider);
            const cached = modelCache.get(id);
            if (cached && !(options && options.refresh === true)) return cached;
            const models = await fetchModels(id, await requireKey(id));
            modelCache.set(id, models);
            return models;
        },

        /**
         * Validates and starts a stream; returns at once. Events (ending in `done`
         * or `error`) arrive through `emit`.
         * @param {unknown} requestId
         * @param {unknown} rawRequest
         */
        async startChat(requestId, rawRequest) {
            const epoch = abortEpoch;
            await requireEnabled();
            if (!isValidItemId(requestId)) invalid('The chat request id is invalid.');
            const id = /** @type {string} */ (requestId);
            const request = sanitizeRequest(rawRequest);
            const key = await keys.get(request.provider);
            if (!key) invalid(`${request.provider} is not set up. Add its API key in Settings → AI.`);
            // Checked after the awaits so two concurrent starts with one id can't both register.
            if (active.has(id)) invalid('That chat request is already running.');
            // AI was turned off (or the project/window closed) while this chat was starting: never send it.
            if (abortEpoch !== epoch) throw new LlmError('CANCELLED', 'Cancelled');
            const entry = { controller: new globalThis.AbortController(), finished: false };
            active.set(id, entry);
            void runStream(id, request, /** @type {string} */ (key), entry);
            return id;
        },

        /** @param {unknown} requestId */
        async cancel(requestId) {
            await requireEnabled();
            if (typeof requestId === 'string') abortOne(requestId);
        },

        async cancelAll() {
            await requireEnabled();
            abortAll();
        },

        /**
         * Sends one extraction request and resolves with the validated reply
         * ({ proposals, summary, dropped, model, usage? }). Cancelled by cancelExtract or abortAll.
         * @param {unknown} requestId
         * @param {unknown} rawRequest
         */
        async extract(requestId, rawRequest) {
            const epoch = abortEpoch;
            await requireEnabled();
            if (!isValidItemId(requestId)) invalid('The extraction request id is invalid.');
            const id = /** @type {string} */ (requestId);
            const request = sanitizeExtractRequest(rawRequest);
            const key = await keys.get(request.provider);
            if (!key) invalid(`${request.provider} is not set up. Add its API key in Settings → AI.`);
            if (active.has(id)) invalid('That extraction is already running.');
            // AI was turned off (or the project/window closed) while this was starting: never send it.
            if (abortEpoch !== epoch) throw new LlmError('CANCELLED', 'Cancelled');
            /** @type {ActiveEntry} */
            const entry = { controller: new globalThis.AbortController(), finished: false };
            active.set(id, entry);
            try {
                return await collectReply(request, /** @type {string} */ (key), entry);
            } catch (err) {
                if (entry.finished) throw new LlmError('CANCELLED', 'Cancelled');
                const e = /** @type {any} */ (err);
                if (err instanceof LlmError) throw new LlmError(e.code, scrub(e.message, [/** @type {string} */ (key)]));
                logger.warn('Extraction failed unexpectedly', scrub(String(e?.message ?? e), [/** @type {string} */ (key)]));
                throw new LlmError('PROVIDER', 'The provider reported an error.');
            } finally {
                entry.finished = true;
                if (active.get(id) === entry) active.delete(id);
            }
        },

        /** @param {unknown} requestId */
        async cancelExtract(requestId) {
            await requireEnabled();
            if (typeof requestId === 'string') abortOne(requestId);
        },
    };
}
