/**
 * Shared source normalisation for provider adapters.
 * http/https only, deduped by URL (first title wins), original order preserved.
 * @param {{ url?: unknown, title?: unknown }[]} list
 * @returns {{ title?: string, url: string }[]}
 */
export function normalizeSources(list) {
    /** @type {Map<string, { title?: string, url: string }>} */
    const seen = new Map();
    for (const item of list) {
        const url = item && item.url;
        if (typeof url !== 'string' || !/^https?:\/\//i.test(url) || seen.has(url)) continue;
        const title = item.title;
        seen.set(url, typeof title === 'string' && title ? { title, url } : { url });
    }
    return [...seen.values()];
}
