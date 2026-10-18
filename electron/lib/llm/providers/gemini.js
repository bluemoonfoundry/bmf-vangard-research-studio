import { LlmError, requestJson, requestStream, scrub } from '../http.js';
import { readSse } from '../sse.js';

/**
 * Google Gemini adapter (Generative Language API, v1beta).
 *
 * Rules (verified against https://ai.google.dev/api/generate-content, /api/models):
 *  - key goes in the `x-goog-api-key` header, never the URL
 *  - models:  GET  /v1beta/models?pageToken=...   (keep `generateContent`, strip `models/`)
 *  - stream:  POST /v1beta/models/{model}:streamGenerateContent?alt=sse
 *  - system -> systemInstruction; assistant -> role "model"; temperature -> generationConfig (only if set)
 *  - webSearch -> tools[{ google_search: {} }]; readUrls -> tools[{ url_context: {} }]
 *  - sources: candidates[].groundingMetadata.groundingChunks[].web {uri,title}, deduped, http(s) only
 *  - searchEntryPoint.renderedContent -> one `extras` event
 *  - web search / URL context: model ids `gemini-<major>` with major >= 2
 */
const DEFAULT_BASE_URL = 'https://generativelanguage.googleapis.com';
const MIN_TOOL_MAJOR = 2;

/** @typedef {{ webSearch: boolean, readUrls: boolean, temperature: boolean }} Capabilities */
/** @typedef {{ id: string, name: string, inputTokenLimit?: number, capabilities: Capabilities }} ModelInfo */

/** @param {string} modelId @returns {Capabilities} */
function capabilitiesFor(modelId) {
    const m = /^gemini-(\d+)/.exec(modelId);
    const tools = !!m && Number(m[1]) >= MIN_TOOL_MAJOR;
    return { webSearch: tools, readUrls: tools, temperature: true };
}

/** @param {any} request */
function buildBody(request) {
    /** @type {any} */
    const body = {
        contents: request.messages.map((/** @type {any} */ m) => ({
            role: m.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: m.text }],
        })),
    };
    if (request.system) body.systemInstruction = { parts: [{ text: request.system }] };
    if (request.temperature != null) body.generationConfig = { temperature: request.temperature };
    const tools = [];
    if (request.webSearch) tools.push({ google_search: {} });
    if (request.readUrls) tools.push({ url_context: {} });
    if (tools.length) body.tools = tools;
    return body;
}

/** @param {unknown} uri */
function isHttpUrl(uri) {
    return typeof uri === 'string' && /^https?:\/\//i.test(uri);
}

/** @param {Map<string, {title?: string, url: string}>} into @param {any} grounding */
function collectSources(into, grounding) {
    for (const chunk of (grounding && grounding.groundingChunks) || []) {
        const web = chunk && chunk.web;
        if (!web || !isHttpUrl(web.uri) || into.has(web.uri)) continue;
        into.set(web.uri, web.title ? { title: web.title, url: web.uri } : { url: web.uri });
    }
}

/**
 * @param {{ baseUrl?: string, fetchFn?: typeof fetch }} [opts]
 */
export function createGeminiAdapter({ baseUrl = DEFAULT_BASE_URL, fetchFn = globalThis.fetch } = {}) {
    return {
        id: /** @type {const} */ ('gemini'),

        /** @param {string} key @param {AbortSignal} signal @returns {Promise<ModelInfo[]>} */
        async listModels(key, signal) {
            /** @type {ModelInfo[]} */
            const out = [];
            let pageToken = '';
            do {
                const url = `${baseUrl}/v1beta/models${pageToken ? `?pageToken=${encodeURIComponent(pageToken)}` : ''}`;
                const page = await requestJson(url, { headers: { 'x-goog-api-key': key }, signal, fetchFn, secrets: [key] });
                for (const m of page.models || []) {
                    if (!(m.supportedGenerationMethods || []).includes('generateContent')) continue;
                    const id = String(m.name).replace(/^models\//, '');
                    /** @type {ModelInfo} */
                    const info = { id, name: m.displayName || id, capabilities: capabilitiesFor(id) };
                    if (typeof m.inputTokenLimit === 'number') info.inputTokenLimit = m.inputTokenLimit;
                    out.push(info);
                }
                pageToken = page.nextPageToken || '';
            } while (pageToken);
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
            const url = `${baseUrl}/v1beta/models/${encodeURIComponent(request.model)}:streamGenerateContent?alt=sse`;
            const body = await requestStream(url, {
                headers: { 'x-goog-api-key': key },
                body: buildBody(request),
                signal,
                fetchFn,
                secrets,
            });

            const sources = new Map();
            let entryPointHtml = '';
            let model = request.model;
            /** @type {{ inputTokens?: number, outputTokens?: number } | undefined} */
            let usage;
            let blocked = '';
            let gotText = false;

            for await (const ev of readSse(body, { signal, secrets })) {
                if (signal.aborted) throw new LlmError('CANCELLED', 'Request cancelled.');
                let chunk;
                try {
                    chunk = JSON.parse(ev.data);
                } catch {
                    throw new LlmError('PROVIDER', 'The provider returned an unreadable stream event.');
                }
                if (chunk.error) throw new LlmError('PROVIDER', scrub(String(chunk.error.message || 'The provider reported an error.'), secrets));
                if (chunk.modelVersion) model = chunk.modelVersion;
                if (chunk.promptFeedback && chunk.promptFeedback.blockReason) blocked = chunk.promptFeedback.blockReason;
                const u = chunk.usageMetadata;
                if (u) {
                    usage = usage || {};
                    if (typeof u.promptTokenCount === 'number') usage.inputTokens = u.promptTokenCount;
                    if (typeof u.candidatesTokenCount === 'number') usage.outputTokens = u.candidatesTokenCount;
                }
                const cand = chunk.candidates && chunk.candidates[0];
                if (!cand) continue;
                for (const part of (cand.content && cand.content.parts) || []) {
                    if (part.thought || typeof part.text !== 'string' || part.text === '') continue;
                    gotText = true;
                    onEvent({ type: 'text', delta: part.text });
                }
                collectSources(sources, cand.groundingMetadata);
                const html = cand.groundingMetadata && cand.groundingMetadata.searchEntryPoint && cand.groundingMetadata.searchEntryPoint.renderedContent;
                if (html) entryPointHtml = html;
            }

            if (!gotText && blocked) throw new LlmError('BAD_REQUEST', scrub(`The request was blocked by the provider (${blocked}).`, secrets));
            if (sources.size) onEvent({ type: 'sources', sources: [...sources.values()] });
            if (entryPointHtml) onEvent({ type: 'extras', extras: { gemini: { searchEntryPointHtml: entryPointHtml } } });
            onEvent(usage ? { type: 'done', model, usage } : { type: 'done', model });
        },
    };
}
