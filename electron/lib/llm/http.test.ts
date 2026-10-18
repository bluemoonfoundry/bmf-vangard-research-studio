import { describe, it, expect } from 'vitest';
import { LlmError, mapHttpStatus, scrub, requestJson, requestStream } from './http.js';

const res = (status: number, body: string, statusText = 'Err') => new Response(body, { status, statusText });
type F = typeof fetch;
const base = (fetchFn: F, extra = {}) => ({ headers: {}, signal: undefined, fetchFn, secrets: [] as string[], ...extra });

async function codeOf(p: Promise<unknown>) {
    try {
        await p;
    } catch (e) {
        expect(e).toBeInstanceOf(LlmError);
        return e as LlmError;
    }
    throw new Error('did not throw');
}

describe('mapHttpStatus', () => {
    it('maps statuses', () => {
        expect(mapHttpStatus(401)).toBe('AUTH');
        expect(mapHttpStatus(403)).toBe('AUTH');
        expect(mapHttpStatus(429)).toBe('RATE_LIMIT');
        for (const s of [400, 404, 413, 422]) expect(mapHttpStatus(s)).toBe('BAD_REQUEST');
        expect(mapHttpStatus(500)).toBe('PROVIDER');
    });
});

describe('scrub', () => {
    it('redacts secrets and key= values', () => {
        expect(scrub('a sk-X b sk-X', ['sk-X', ''])).toBe('a [redacted] b [redacted]');
        expect(scrub('https://x/y?alt=sse&key=abc123&z=1', [])).toBe('https://x/y?alt=sse&key=[redacted]&z=1');
    });
});

describe('requestJson', () => {
    it('returns parsed JSON and sends body', async () => {
        let seen: RequestInit | undefined;
        const f = async (_u: unknown, init?: RequestInit) => ((seen = init), res(200, '{"ok":1}'));
        const out = await requestJson('http://x', base(f, { method: 'POST', body: { a: 1 } }));
        expect(out).toEqual({ ok: 1 });
        expect(seen?.method).toBe('POST');
        expect(seen?.body).toBe('{"a":1}');
    });
    it('maps 401 to AUTH', async () => {
        expect((await codeOf(requestJson('http://x', base(async () => res(401, '')))) ).code).toBe('AUTH');
    });
    it('maps 429 to RATE_LIMIT', async () => {
        expect((await codeOf(requestJson('http://x', base(async () => res(429, '')))) ).code).toBe('RATE_LIMIT');
    });
    it("uses the provider's error.message", async () => {
        const e = await codeOf(requestJson('http://x', base(async () => res(400, '{"error":{"message":"nope"}}'))));
        expect(e.message).toBe('nope');
        expect(e.code).toBe('BAD_REQUEST');
    });
    it('falls back to status text', async () => {
        const e = await codeOf(requestJson('http://x', base(async () => res(500, 'not json', 'Boom'))));
        expect(e.message).toContain('Boom');
    });
    it('scrubs the key from error messages', async () => {
        const e = await codeOf(
            requestJson('http://x', base(async () => res(400, '{"error":{"message":"bad key sk-SECRET"}}'), { secrets: ['sk-SECRET'] })),
        );
        expect(e.message).not.toContain('sk-SECRET');
    });
    it('strips key= query values', async () => {
        const e = await codeOf(
            requestJson('http://x', base(async () => res(400, '{"error":{"message":"at http://h/p?key=abc123 failed"}}'))),
        );
        expect(e.message).not.toContain('abc123');
    });
    it('abort becomes CANCELLED', async () => {
        const f = async () => {
            throw Object.assign(new Error('aborted'), { name: 'AbortError' });
        };
        expect((await codeOf(requestJson('http://x', base(f)))).code).toBe('CANCELLED');
    });
    it('fetch TypeError becomes NETWORK and scrubs secrets', async () => {
        const f = async () => {
            throw new TypeError('fetch failed sk-SECRET');
        };
        const e = await codeOf(requestJson('http://x', base(f, { secrets: ['sk-SECRET'] })));
        expect(e.code).toBe('NETWORK');
        expect(e.message).not.toContain('sk-SECRET');
    });
});

describe('requestStream', () => {
    it('returns the body stream', async () => {
        const s = await requestStream('http://x', base(async () => res(200, 'hi')));
        expect(await new Response(s).text()).toBe('hi');
    });
    it('maps non-2xx', async () => {
        expect((await codeOf(requestStream('http://x', base(async () => res(403, ''))))).code).toBe('AUTH');
    });
});

describe('abort and parse mapping', () => {
    it('treats a custom abort reason as CANCELLED', async () => {
        const ac = new AbortController();
        ac.abort(new Error('user said stop'));
        const f = (async () => {
            throw ac.signal.reason;
        }) as unknown as typeof fetch;
        expect((await codeOf(requestJson('http://x', base(f, { signal: ac.signal })))).code).toBe('CANCELLED');
    });
    it('maps a 2xx with invalid JSON to PROVIDER', async () => {
        expect((await codeOf(requestJson('http://x', base(async () => res(200, '<html>'))))).code).toBe('PROVIDER');
    });
});
