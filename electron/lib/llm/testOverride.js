const LOOPBACK_HOSTS = ['127.0.0.1', 'localhost', '[::1]'];

/**
 * Decides whether the test-only `VRS_LLM_BASE_URL` override may be used. It redirects every provider
 * call (decrypted key included), so it is honoured only in unpackaged builds and only for a plain
 * http loopback origin (any port). Warnings never echo the value.
 * @param {string | undefined} value
 * @param {{ isPackaged: boolean }} opts
 * @returns {{ baseUrl: string | undefined, warning: string | null }}
 */
export function resolveTestBaseUrl(value, { isPackaged }) {
    if (!value) return { baseUrl: undefined, warning: null };
    if (isPackaged) return { baseUrl: undefined, warning: 'VRS_LLM_BASE_URL is ignored in packaged builds.' };
    let url;
    try {
        url = new URL(value);
    } catch {
        return { baseUrl: undefined, warning: 'VRS_LLM_BASE_URL is not a valid URL; ignored.' };
    }
    if (url.protocol !== 'http:' || !LOOPBACK_HOSTS.includes(url.hostname) || url.username || url.password) {
        return { baseUrl: undefined, warning: 'VRS_LLM_BASE_URL must be an http loopback origin; ignored.' };
    }
    return { baseUrl: value.replace(/\/+$/, ''), warning: null };
}
