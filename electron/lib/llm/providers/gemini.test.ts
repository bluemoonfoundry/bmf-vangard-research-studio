import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createGeminiAdapter } from './gemini.js';

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
const KEY = 'SECRET-KEY-123';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type StreamEvent = any;
type Call = { url: string; init: RequestInit };
function fakeFetch(responses: { body: string; status?: number; type?: string }[]) {
    const calls: Call[] = [];
    const fetchFn = (async (url: string, init: RequestInit) => {
        calls.push({ url, init });
        const r = responses[Math.min(calls.length - 1, responses.length - 1)];
        return new Response(r.body, {
            status: r.status ?? 200,
            headers: { 'content-type': r.type ?? 'text/event-stream' },
        });
    }) as unknown as typeof fetch;
    return { calls, fetchFn };
}

const baseRequest = {
    provider: 'gemini',
    model: 'gemini-2.5-flash',
    system: 'Be brief.',
    messages: [
        { role: 'user' as const, text: 'Hi' },
        { role: 'assistant' as const, text: 'Hello' },
        { role: 'user' as const, text: 'Again' },
    ],
    temperature: null as number | null,
    webSearch: false,
    readUrls: false,
};

async function run(over: Partial<typeof baseRequest>, responses: { body: string; status?: number; type?: string }[] = [{ body: fixture('gemini-text.txt') }]) {
    const { calls, fetchFn } = fakeFetch(responses);
    const events: StreamEvent[] = [];
    await createGeminiAdapter({ fetchFn }).stream({ ...baseRequest, ...over }, KEY, new AbortController().signal, (e: StreamEvent) => events.push(e));
    return { calls, events, body: JSON.parse(String(calls[0].init.body)) };
}

describe('gemini adapter', () => {
    it('sends the key as a header, not in the URL', async () => {
        const { calls } = await run({});
        expect(calls[0].url).toBe(
            'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:streamGenerateContent?alt=sse',
        );
        expect(calls[0].url).not.toContain('key=');
        expect((calls[0].init.headers as Record<string, string>)['x-goog-api-key']).toBe(KEY);
    });

    it('translates system, roles and temperature', async () => {
        const { body } = await run({ temperature: 0.4 });
        expect(body.systemInstruction.parts[0].text).toBe('Be brief.');
        expect(body.contents.map((c: { role: string }) => c.role)).toEqual(['user', 'model', 'user']);
        expect(body.contents[1].parts[0].text).toBe('Hello');
        expect(body.generationConfig.temperature).toBe(0.4);
        const { body: b2 } = await run({ temperature: null });
        expect(b2.generationConfig).toBeUndefined();
    });

    it('adds tools only when toggled', async () => {
        expect((await run({})).body.tools).toBeUndefined();
        expect((await run({ webSearch: true, readUrls: true })).body.tools).toEqual([{ google_search: {} }, { url_context: {} }]);
        expect((await run({ readUrls: true })).body.tools).toEqual([{ url_context: {} }]);
    });

    it('streams text deltas then done', async () => {
        const { events } = await run({});
        expect(events).toEqual([
            { type: 'text', delta: 'Hel' },
            { type: 'text', delta: 'lo' },
            { type: 'done', model: 'gemini-2.5-flash', usage: { inputTokens: 7, outputTokens: 2 } },
        ]);
    });

    it('emits deduped http(s) sources and the search entry point', async () => {
        const { events } = await run({ webSearch: true }, [{ body: fixture('gemini-grounded.txt') }]);
        expect(events.map((e) => e.type)).toEqual(['text', 'text', 'sources', 'extras', 'done']);
        expect(events[2].sources).toEqual([
            { title: 'example.com', url: 'https://example.com/euro' },
            { title: 'news.example.org', url: 'https://news.example.org/final' },
        ]);
        expect(events[3].extras).toEqual({ gemini: { searchEntryPointHtml: '<div class="container">Search suggestions</div>' } });
    });

    it('lists generateContent models across pages without the models/ prefix', async () => {
        const page1 = {
            models: [
                { name: 'models/gemini-2.5-flash', displayName: 'Gemini 2.5 Flash', inputTokenLimit: 1048576, supportedGenerationMethods: ['generateContent', 'countTokens'] },
                { name: 'models/embedding-001', displayName: 'Embedding', supportedGenerationMethods: ['embedContent'] },
            ],
            nextPageToken: 'tok2',
        };
        const page2 = { models: [{ name: 'models/gemini-1.5-pro', displayName: 'Gemini 1.5 Pro', inputTokenLimit: 2000000, supportedGenerationMethods: ['generateContent'] }] };
        const { calls, fetchFn } = fakeFetch([
            { body: JSON.stringify(page1), type: 'application/json' },
            { body: JSON.stringify(page2), type: 'application/json' },
        ]);
        const models = await createGeminiAdapter({ fetchFn }).listModels(KEY, new AbortController().signal);
        expect(models.map((m) => m.id)).toEqual(['gemini-2.5-flash', 'gemini-1.5-pro']);
        expect(models[0]).toMatchObject({ name: 'Gemini 2.5 Flash', inputTokenLimit: 1048576, capabilities: { webSearch: true, readUrls: true, temperature: true } });
        expect(models[1].capabilities).toEqual({ webSearch: false, readUrls: false, temperature: true });
        expect(calls[0].url).not.toContain('pageToken');
        expect(calls[1].url).toContain('pageToken=tok2');
        expect((calls[1].init.headers as Record<string, string>)['x-goog-api-key']).toBe(KEY);
        expect(calls.every((c) => !c.url.includes('key='))).toBe(true);
    });

    it('derives capabilities from the model major version', () => {
        const a = createGeminiAdapter({});
        expect(a.capabilities('gemini-2.0-flash').webSearch).toBe(true);
        expect(a.capabilities('gemini-3-pro').readUrls).toBe(true);
        expect(a.capabilities('gemini-10-ultra').webSearch).toBe(true);
        expect(a.capabilities('gemini-1.5-pro').webSearch).toBe(false);
        expect(a.capabilities('gemma-3-27b').readUrls).toBe(false);
    });

    it('throws AUTH on 403 without leaking the key', async () => {
        await expect(run({}, [{ body: fixture('gemini-error.txt'), status: 403, type: 'application/json' }])).rejects.toMatchObject({
            name: 'LlmError',
            code: 'AUTH',
            message: expect.not.stringContaining(KEY),
        });
    });

    it('throws PROVIDER on an in-stream error object', async () => {
        const body = 'data: {"error":{"code":500,"message":"boom"}}\n\n';
        await expect(run({}, [{ body }])).rejects.toMatchObject({ code: 'PROVIDER' });
    });

    it('scrubs the key from in-stream errors', async () => {
        const body = `data: {"error":{"code":403,"message":"bad key=${KEY} ${KEY}"}}\n\n`;
        const err = await run({}, [{ body }]).catch((e) => e);
        expect(err.code).toBe('PROVIDER');
        expect(err.message).not.toContain(KEY);
        expect(err.message).toContain('[redacted]');
    });

    it('keeps earlier usage fields when a later chunk omits them', async () => {
        const body = [
            'data: {"candidates":[{"content":{"parts":[{"text":"a"}]}}],"usageMetadata":{"promptTokenCount":5,"candidatesTokenCount":3}}',
            'data: {"usageMetadata":{"totalTokenCount":8}}',
            '',
        ].join('\n\n');
        const { events } = await run({}, [{ body }]);
        expect(events[events.length - 1]).toEqual({ type: 'done', model: 'gemini-2.5-flash', usage: { inputTokens: 5, outputTokens: 3 } });
    });

    it('throws CANCELLED when aborted mid-stream', async () => {
        const ac = new AbortController();
        const enc = new TextEncoder();
        const fetchFn = (async () =>
            new Response(
                new ReadableStream({
                    start(c) {
                        c.enqueue(enc.encode('data: {"candidates":[{"content":{"parts":[{"text":"a"}]}}]}\n\n'));
                        // Like real fetch: aborting errors the body stream with an AbortError.
                        ac.signal.addEventListener('abort', () => c.error(new DOMException('aborted', 'AbortError')));
                    },
                }),
            )) as unknown as typeof fetch;
        const p = createGeminiAdapter({ fetchFn }).stream(baseRequest, KEY, ac.signal, () => ac.abort());
        await expect(p).rejects.toMatchObject({ code: 'CANCELLED' });
    });
});
