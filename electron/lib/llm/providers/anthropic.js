import { LlmError, requestJson, requestStream, scrub } from '../http.js';
import { readSse } from '../sse.js';
import { normalizeSources } from '../sources.js';

/**
 * Anthropic Claude adapter (Messages API).
 *
 * Rules (verified Oct 2026 against platform.claude.com/docs: build-with-claude/streaming,
 * api/models/list, agents-and-tools/tool-use/{web-search-tool,web-fetch-tool,tool-reference}):
 *  - headers: `x-api-key`, `anthropic-version: 2023-06-01`; web search/fetch need no `anthropic-beta` header
 *  - models:  GET /v1/models?limit=1000&after_id=<last_id> while has_more; `max_input_tokens` -> inputTokenLimit
 *  - stream:  POST /v1/messages { stream: true, system, max_tokens, messages, temperature? (0–1), tools? }
 *  - webSearch -> web_search_20250305; readUrls -> web_fetch_20250910 (the original versions: no dynamic
 *    filtering / code-execution requirement, so they work on every model that supports the tool)
 *  - sources: web_search_tool_result content[] {url,title}, web_fetch_tool_result {url, document title},
 *    citations_delta (web_search_result_location {url,title}); deduped, http(s) only
 *  - events: message_start.message.model/usage, content_block_delta/text_delta, message_delta.usage,
 *    `error` event -> PROVIDER
 *  - truncated: message_delta.delta.stop_reason max_tokens | model_context_window_exceeded -> 'max_tokens',
 *    pause_turn (a server-tool loop hit its iteration limit) -> 'pause_turn' (build-with-claude/handling-stop-reasons, Oct 2026)
 *  - web tools: model ids `claude-<line>-<major>...` with major >= 4, plus claude-3-7-sonnet and claude-3-5-haiku
 *  - jsonSchema (extraction) -> output_config.format { type: 'json_schema', schema }, no beta header; objects need
 *    additionalProperties: false; Claude 4.5+ only (build-with-claude/structured-outputs, Oct 2026)
 *  - maxOutputTokens overrides max_tokens (extraction asks for more)
 */
const DEFAULT_BASE_URL = 'https://api.anthropic.com';
const ANTHROPIC_VERSION = '2023-06-01';
const MAX_OUTPUT_TOKENS = 8192;
const MODELS_PAGE_SIZE = 1000;
const WEB_SEARCH_TOOL = { type: 'web_search_20250305', name: 'web_search' };
const WEB_FETCH_TOOL = { type: 'web_fetch_20250910', name: 'web_fetch' };

/** @typedef {{ webSearch: boolean, readUrls: boolean, temperature: boolean }} Capabilities */
/** @typedef {{ id: string, name: string, inputTokenLimit?: number, capabilities: Capabilities }} ModelInfo */

/** Model-id patterns that support the server web tools (first match wins). */
const TOOL_RULES = [
    { re: /^claude-(?:opus|sonnet|haiku|fable|mythos)-(\d+)/, minMajor: 4 },
    { re: /^claude-3-7-sonnet/, minMajor: 0 },
    { re: /^claude-3-5-haiku/, minMajor: 0 },
];

/** @param {string} modelId @returns {Capabilities} */
function capabilitiesFor(modelId) {
    for (const rule of TOOL_RULES) {
        const m = rule.re.exec(modelId);
        if (m && (!rule.minMajor || Number(m[1]) >= rule.minMajor)) return { webSearch: true, readUrls: true, temperature: true };
    }
    return { webSearch: false, readUrls: false, temperature: true };
}

/** @param {string} key */
function authHeaders(key) {
    return { 'x-api-key': key, 'anthropic-version': ANTHROPIC_VERSION };
}

/** @param {any} request */
function buildBody(request) {
    /** @type {any} */
    const body = {
        model: request.model,
        stream: true,
        max_tokens: request.maxOutputTokens ?? MAX_OUTPUT_TOKENS,
        messages: request.messages.map((/** @type {any} */ m) => ({ role: m.role, content: m.text })),
    };
    if (request.system) body.system = request.system;
    if (request.jsonSchema) body.output_config = { format: { type: 'json_schema', schema: request.jsonSchema } };
    // Anthropic accepts 0–1; the shared slider goes to 2.
    if (request.temperature != null) body.temperature = Math.min(request.temperature, 1);
    const tools = [];
    if (request.webSearch) tools.push({ ...WEB_SEARCH_TOOL });
    if (request.readUrls) tools.push({ ...WEB_FETCH_TOOL });
    if (tools.length) body.tools = tools;
    return body;
}

/** Stop reasons that leave the reply unfinished, and the `truncated` reason they become. */
const TRUNCATING_STOPS = /** @type {Record<string, string>} */ ({
    max_tokens: 'max_tokens',
    model_context_window_exceeded: 'max_tokens',
    pause_turn: 'pause_turn',
});

/** @param {{ url?: unknown, title?: unknown }[]} into @param {unknown} url @param {unknown} title */
function addSource(into, url, title) {
    into.push({ url, title });
}

/**
 * @param {{ baseUrl?: string, fetchFn?: typeof fetch }} [opts]
 */
export function createAnthropicAdapter({ baseUrl = DEFAULT_BASE_URL, fetchFn = globalThis.fetch } = {}) {
    return {
        id: /** @type {const} */ ('anthropic'),

        /** @param {string} key @param {AbortSignal} signal @returns {Promise<ModelInfo[]>} */
        async listModels(key, signal) {
            /** @type {ModelInfo[]} */
            const out = [];
            let afterId = '';
            for (;;) {
                const url = `${baseUrl}/v1/models?limit=${MODELS_PAGE_SIZE}${afterId ? `&after_id=${encodeURIComponent(afterId)}` : ''}`;
                const page = await requestJson(url, { headers: authHeaders(key), signal, fetchFn, secrets: [key] });
                for (const m of page.data || []) {
                    const id = String(m.id);
                    const capabilities = capabilitiesFor(id);
                    const search = m.capabilities && m.capabilities.server_tools && m.capabilities.server_tools.web_search;
                    if (search && typeof search.supported === 'boolean') capabilities.webSearch = search.supported;
                    /** @type {ModelInfo} */
                    const info = { id, name: m.display_name || id, capabilities };
                    if (typeof m.max_input_tokens === 'number' && m.max_input_tokens > 0) info.inputTokenLimit = m.max_input_tokens;
                    out.push(info);
                }
                if (!page.has_more || !page.last_id || page.last_id === afterId) break;
                afterId = page.last_id;
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
            const body = await requestStream(`${baseUrl}/v1/messages`, {
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
            /** @type {string | undefined} */
            let truncated;
            /** @param {any} u */
            const takeUsage = (u) => {
                if (!u) return;
                usage = usage || {};
                if (typeof u.input_tokens === 'number') usage.inputTokens = u.input_tokens;
                if (typeof u.output_tokens === 'number') usage.outputTokens = u.output_tokens;
            };

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
                        throw new LlmError('PROVIDER', scrub(String((msg.error && msg.error.message) || 'The provider reported an error.'), secrets));
                    case 'message_start':
                        if (msg.message && msg.message.model) model = msg.message.model;
                        takeUsage(msg.message && msg.message.usage);
                        break;
                    case 'message_delta': {
                        takeUsage(msg.usage);
                        const stop = msg.delta && msg.delta.stop_reason;
                        if (typeof stop === 'string' && Object.hasOwn(TRUNCATING_STOPS, stop)) truncated = TRUNCATING_STOPS[stop];
                        break;
                    }
                    case 'content_block_start': {
                        const block = msg.content_block;
                        if (block && block.type === 'web_search_tool_result' && Array.isArray(block.content)) {
                            for (const r of block.content) addSource(cited, r && r.url, r && r.title);
                        } else if (block && block.type === 'web_fetch_tool_result' && block.content && block.content.type === 'web_fetch_result') {
                            addSource(cited, block.content.url, block.content.content && block.content.content.title);
                        }
                        break;
                    }
                    case 'content_block_delta': {
                        const d = msg.delta;
                        if (d && d.type === 'text_delta' && typeof d.text === 'string' && d.text !== '') {
                            onEvent({ type: 'text', delta: d.text });
                        } else if (d && d.type === 'citations_delta' && d.citation && d.citation.type === 'web_search_result_location') {
                            addSource(cited, d.citation.url, d.citation.title);
                        }
                        break;
                    }
                    default:
                        break;
                }
            }

            const sources = normalizeSources(cited);
            if (sources.length) onEvent({ type: 'sources', sources });
            onEvent({ type: 'done', model, ...(usage && { usage }), ...(truncated && { truncated }) });
        },
    };
}
