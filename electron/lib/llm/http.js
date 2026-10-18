/** @typedef {'AUTH'|'RATE_LIMIT'|'BAD_REQUEST'|'NETWORK'|'CANCELLED'|'PROVIDER'|'AI_DISABLED'|'INVALID'|'UNAVAILABLE'} LlmErrorCode */

export class LlmError extends Error {
    /**
     * @param {LlmErrorCode} code
     * @param {string} message
     */
    constructor(code, message) {
        super(message);
        this.name = 'LlmError';
        this.code = code;
    }
}

/** @param {number} status @returns {LlmErrorCode} */
export function mapHttpStatus(status) {
    if (status === 401 || status === 403) return 'AUTH';
    if (status === 429) return 'RATE_LIMIT';
    if (status === 400 || status === 404 || status === 413 || status === 422) return 'BAD_REQUEST';
    return 'PROVIDER';
}

/**
 * Remove secrets and `key=` query values from text bound for errors or logs.
 * @param {string} text
 * @param {string[]} secrets
 */
export function scrub(text, secrets) {
    let out = String(text ?? '');
    for (const s of secrets || []) {
        if (s) out = out.split(s).join('[redacted]');
    }
    return out.replace(/([?&]key=)[^&\s"')]+/gi, '$1[redacted]');
}

/**
 * @param {unknown} err
 * @param {string[]} secrets
 */
function mapThrown(err, secrets) {
    if (err instanceof LlmError) return err;
    const e = /** @type {any} */ (err);
    if (e && (e.name === 'AbortError' || e.name === 'TimeoutError')) return new LlmError('CANCELLED', 'Request cancelled.');
    return new LlmError('NETWORK', scrub(e && e.message ? e.message : 'Network request failed.', secrets));
}

/** @param {Response} res @param {string[]} secrets */
async function errorFrom(res, secrets) {
    let message = res.statusText || `HTTP ${res.status}`;
    try {
        const parsed = JSON.parse(await res.text());
        const m = parsed && parsed.error && parsed.error.message;
        if (typeof m === 'string' && m) message = m;
    } catch {
        /* keep status text */
    }
    return new LlmError(mapHttpStatus(res.status), scrub(message, secrets));
}

/**
 * @param {string} url
 * @param {{ method?: string, headers?: Record<string,string>, body?: unknown, signal?: AbortSignal, fetchFn?: typeof fetch, secrets?: string[] }} opts
 * @returns {Promise<Response>}
 */
async function send(url, opts) {
    const { method, headers, body, signal, fetchFn = globalThis.fetch, secrets = [] } = opts;
    let res;
    try {
        res = await fetchFn(url, {
            method: method || (body === undefined ? 'GET' : 'POST'),
            headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...headers },
            body: body === undefined ? undefined : JSON.stringify(body),
            signal,
        });
    } catch (err) {
        throw mapThrown(err, secrets);
    }
    if (!res.ok) throw await errorFrom(res, secrets);
    return res;
}

/**
 * @param {string} url
 * @param {Parameters<typeof send>[1]} opts
 * @returns {Promise<any>}
 */
export async function requestJson(url, opts) {
    const res = await send(url, opts);
    try {
        return await res.json();
    } catch (err) {
        throw mapThrown(err, opts.secrets || []);
    }
}

/**
 * @param {string} url
 * @param {Parameters<typeof send>[1]} opts
 * @returns {Promise<ReadableStream<Uint8Array>>}
 */
export async function requestStream(url, opts) {
    const res = await send(url, opts);
    if (!res.body) throw new LlmError('PROVIDER', 'The provider returned an empty response.');
    return res.body;
}
