import { LlmError, requestJson, requestStream, scrub } from '../http.js';
import { readSse } from '../sse.js';
import { normalizeSources } from '../sources.js';

/**
 * OpenAI adapter (Responses API).
 *
 * Rules (verified Oct 2026 against developers.openai.com/api/docs/guides/{tools-web-search,streaming-responses},
 * the Responses streaming-events reference and the community streaming-events field guide):
 *  - header:  `Authorization: Bearer <key>`
 *  - models:  GET /v1/models (no token limits are reported); chat-capable families only
 *  - stream:  POST /v1/responses { stream: true, store: false, model, instructions, input: [{role, content}], temperature?, tools? }
 *  - webSearch -> tools[{ type: 'web_search' }]; there is no URL-reading tool, so readUrls is never available
 *  - events: response.output_text.delta {delta}; response.output_text.annotation.added {annotation};
 *    response.completed|response.incomplete {response:{model,usage,output[]}}; response.failed {response.error};
 *    `error` {code,message}
 *  - sources: url_citation annotations {url,title} (streamed and in the completed output), http(s) only, deduped
 *  - temperature: rejected by reasoning models (o-series, gpt-5 and later) except the `-chat` variants
 */
const DEFAULT_BASE_URL = 'https://api.openai.com';

/** @typedef {{ webSearch: boolean, readUrls: boolean, temperature: boolean }} Capabilities */
/** @typedef {{ id: string, name: string, inputTokenLimit?: number, capabilities: Capabilities }} ModelInfo */

/** Ids that belong to a chat-capable family. */
const CHAT_FAMILY = /^(?:gpt-|o\d|chatgpt-)/;
/** Non-chat models that share a chat family prefix. */
const NON_CHAT = /embedding|whisper|tts|dall-e|realtime|audio|image|moderation|transcribe|instruct|search-preview|computer-use|codex|davinci|babbage|sora|live/;

/** @param {string} modelId */
function isReasoning(modelId) {
    if (/^o\d/.test(modelId)) return true;
    const m = /^gpt-(\d+)/.exec(modelId);
    return !!m && Number(m[1]) >= 5 && !/-chat(?:-|$)/.test(modelId);
}

/** @param {string} modelId */
function supportsWebSearch(modelId) {
    if (/^o\d/.test(modelId)) return /^o[3-9]/.test(modelId);
    if (/^gpt-4\.1-nano/.test(modelId)) return false;
    return /^gpt-4o|^gpt-4\.1|^gpt-(?:[5-9]|\d{2,})/.test(modelId);
}

/** @param {string} modelId @returns {Capabilities} */
function capabilitiesFor(modelId) {
    return { webSearch: supportsWebSearch(modelId), readUrls: false, temperature: !isReasoning(modelId) };
}

/** @param {string} key */
function authHeaders(key) {
    return { Authorization: `Bearer ${key}` };
}

/** @param {any} request */
function buildBody(request) {
    /** @type {any} */
    const body = {
        model: request.model,
        stream: true,
        // Each request carries its full history, so nothing needs to be kept on OpenAI's side.
        store: false,
        input: request.messages.map((/** @type {any} */ m) => ({ role: m.role, content: m.text })),
    };
    if (request.system) body.instructions = request.system;
    if (request.temperature != null && capabilitiesFor(request.model).temperature) body.temperature = request.temperature;
    if (request.webSearch) body.tools = [{ type: 'web_search' }];
    return body;
}

/** @param {any} annotation @param {{ url?: unknown, title?: unknown }[]} into */
function takeCitation(annotation, into) {
    if (annotation && annotation.type === 'url_citation') into.push({ url: annotation.url, title: annotation.title });
}

/**
 * @param {{ baseUrl?: string, fetchFn?: typeof fetch }} [opts]
 */
export function createOpenAiAdapter({ baseUrl = DEFAULT_BASE_URL, fetchFn = globalThis.fetch } = {}) {
    return {
        id: /** @type {const} */ ('openai'),

        /** @param {string} key @param {AbortSignal} signal @returns {Promise<ModelInfo[]>} */
        async listModels(key, signal) {
            const page = await requestJson(`${baseUrl}/v1/models`, { headers: authHeaders(key), signal, fetchFn, secrets: [key] });
            /** @type {ModelInfo[]} */
            const out = [];
            for (const m of page.data || []) {
                const id = String(m.id);
                if (!CHAT_FAMILY.test(id) || NON_CHAT.test(id)) continue;
                out.push({ id, name: id, capabilities: capabilitiesFor(id) });
            }
            return out;
        },

        /** @param {string} modelId */
        capabilities: capabilitiesFor,

        /**
         * @param {any} request
         * @param {string} key
         * @param {AbortSignal} signal
         * @param {(e: any) => void} onEvent
         */
        async stream(request, key, signal, onEvent) {
            const secrets = [key];
            const body = await requestStream(`${baseUrl}/v1/responses`, {
                headers: authHeaders(key),
                body: buildBody(request),
                signal,
                fetchFn,
                secrets,
            });

            /** @type {{ url?: unknown, title?: unknown }[]} */
            const cited = [];
            let model = request.model;
            /** @type {{ inputTokens?: number, outputTokens?: number } | undefined} */
            let usage;

            for await (const ev of readSse(body, { signal, secrets })) {
                if (signal.aborted) throw new LlmError('CANCELLED', 'Request cancelled.');
                let msg;
                try {
                    msg = JSON.parse(ev.data);
                } catch {
                    throw new LlmError('PROVIDER', 'The provider returned an unreadable stream event.');
                }
                switch (msg.type) {
                    case 'error':
                        throw new LlmError('PROVIDER', scrub(String(msg.message || 'The provider reported an error.'), secrets));
                    case 'response.failed': {
                        const e = msg.response && msg.response.error;
                        throw new LlmError('PROVIDER', scrub(String((e && e.message) || 'The provider reported an error.'), secrets));
                    }
                    case 'response.output_text.delta':
                        if (typeof msg.delta === 'string' && msg.delta !== '') onEvent({ type: 'text', delta: msg.delta });
                        break;
                    case 'response.output_text.annotation.added':
                        takeCitation(msg.annotation, cited);
                        break;
                    case 'response.completed':
                    case 'response.incomplete': {
                        const r = msg.response || {};
                        if (r.model) model = r.model;
                        if (r.usage) {
                            usage = {};
                            if (typeof r.usage.input_tokens === 'number') usage.inputTokens = r.usage.input_tokens;
                            if (typeof r.usage.output_tokens === 'number') usage.outputTokens = r.usage.output_tokens;
                        }
                        for (const item of r.output || []) {
                            if (!item || item.type !== 'message') continue;
                            for (const part of item.content || []) for (const a of (part && part.annotations) || []) takeCitation(a, cited);
                        }
                        break;
                    }
                    default:
                        break;
                }
            }

            const sources = normalizeSources(cited);
            if (sources.length) onEvent({ type: 'sources', sources });
            onEvent(usage ? { type: 'done', model, usage } : { type: 'done', model });
        },
    };
}
