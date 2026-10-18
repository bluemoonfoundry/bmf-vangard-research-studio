import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createOpenAiAdapter } from './openai.js';

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
    provider: 'openai',
    model: 'gpt-4.1',
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

async function run(over: Partial<typeof baseRequest>, responses: { body: string; status?: number; type?: string }[] = [{ body: fixture('openai-text.txt') }]) {
    const { calls, fetchFn } = fakeFetch(responses);
    const events: StreamEvent[] = [];
    await createOpenAiAdapter({ fetchFn }).stream({ ...baseRequest, ...over }, KEY, new AbortController().signal, (e: StreamEvent) => events.push(e));
    return { calls, events, body: JSON.parse(String(calls[0].init.body)) };
}

describe('openai adapter', () => {
    it('sends a bearer token', async () => {
        const { calls } = await run({});
        expect(calls[0].url).toBe('https://api.openai.com/v1/responses');
        expect((calls[0].init.headers as Record<string, string>).Authorization).toBe(`Bearer ${KEY}`);
    });

    it('maps instructions and input', async () => {
        const { body } = await run({ temperature: 0.4 });
        expect(body).toMatchObject({ stream: true, instructions: 'Be brief.', temperature: 0.4, model: 'gpt-4.1' });
        expect(body.input).toEqual([
            { role: 'user', content: 'Hi' },
            { role: 'assistant', content: 'Hello' },
            { role: 'user', content: 'Again' },
        ]);
        const { body: b2 } = await run({ system: '' });
        expect(b2.instructions).toBeUndefined();
        expect(b2.temperature).toBeUndefined();
    });

    it('adds web search only when toggled', async () => {
        expect((await run({})).body.tools).toBeUndefined();
        expect((await run({ webSearch: true })).body.tools).toEqual([{ type: 'web_search' }]);
        // readUrls has no OpenAI equivalent and is never sent
        expect((await run({ readUrls: true })).body.tools).toBeUndefined();
    });

    it('never sends temperature to models without it', async () => {
        expect((await run({ model: 'o3', temperature: 0.7 })).body.temperature).toBeUndefined();
        expect((await run({ model: 'gpt-5', temperature: 0.7 })).body.temperature).toBeUndefined();
        expect((await run({ model: 'gpt-4o', temperature: 0.7 })).body.temperature).toBe(0.7);
    });

    it('readUrls capability is always false', () => {
        const a = createOpenAiAdapter({});
        for (const id of ['gpt-4.1', 'gpt-4o', 'o3', 'gpt-5', 'gpt-5-chat-latest', 'gpt-3.5-turbo']) expect(a.capabilities(id).readUrls).toBe(false);
        expect(a.capabilities('gpt-4.1')).toEqual({ webSearch: true, readUrls: false, temperature: true });
        expect(a.capabilities('o3').temperature).toBe(false);
        expect(a.capabilities('gpt-5').temperature).toBe(false);
        expect(a.capabilities('gpt-6-astra').temperature).toBe(false);
        expect(a.capabilities('gpt-5-chat-latest').temperature).toBe(true);
        expect(a.capabilities('gpt-3.5-turbo').webSearch).toBe(false);
    });

    it('streams deltas then done', async () => {
        const { events } = await run({});
        expect(events).toEqual([
            { type: 'text', delta: 'Hel' },
            { type: 'text', delta: 'lo' },
            { type: 'done', model: 'gpt-4.1-2025-04-14', usage: { inputTokens: 12, outputTokens: 5 } },
        ]);
    });

    it('collects url_citation sources', async () => {
        const { events } = await run({ webSearch: true }, [{ body: fixture('openai-search.txt') }]);
        expect(events.map((e) => e.type)).toEqual(['text', 'text', 'sources', 'done']);
        expect(events[2].sources).toEqual([
            { title: 'Euro rate', url: 'https://example.com/euro' },
            { title: 'Final news', url: 'https://news.example.org/final' },
        ]);
        expect(events[3].usage).toEqual({ inputTokens: 30, outputTokens: 40 });
    });

    it('throws PROVIDER on response.failed and scrubs the key', async () => {
        const err = await run({}, [{ body: fixture('openai-failed.txt') }]).catch((e) => e);
        expect(err.name).toBe('LlmError');
        expect(err.code).toBe('PROVIDER');
        expect(err.message).not.toContain(KEY);
        expect(err.message).toContain('[redacted]');
    });

    it('throws PROVIDER on an error event and scrubs the key', async () => {
        const body = `event: error\ndata: {"type":"error","code":"rate","message":"slow ${KEY}","param":null,"sequence_number":1}\n\n`;
        const err = await run({}, [{ body }]).catch((e) => e);
        expect(err.code).toBe('PROVIDER');
        expect(err.message).not.toContain(KEY);
        expect(err.message).toContain('[redacted]');
    });

    it('throws AUTH on 401 without leaking the key', async () => {
        await expect(run({}, [{ body: fixture('openai-error.txt'), status: 401, type: 'application/json' }])).rejects.toMatchObject({
            name: 'LlmError',
            code: 'AUTH',
            message: expect.not.stringContaining(KEY),
        });
    });

    it('lists chat-capable models only', async () => {
        const ids = [
            'gpt-4.1',
            'o3',
            'gpt-5',
            'text-embedding-3-small',
            'whisper-1',
            'dall-e-3',
            'gpt-4o-mini-tts',
            'gpt-4o-realtime-preview',
            'gpt-image-1',
            'omni-moderation-latest',
            'gpt-3.5-turbo-instruct',
            'gpt-4o-audio-preview',
            'gpt-4o-transcribe',
            'chatgpt-4o-latest',
        ];
        const data = ids.map((id) => ({ id, object: 'model' }));
        const { calls, fetchFn } = fakeFetch([{ body: JSON.stringify({ object: 'list', data }), type: 'application/json' }]);
        const models = await createOpenAiAdapter({ fetchFn }).listModels(KEY, new AbortController().signal);
        expect(models.map((m) => m.id)).toEqual(['gpt-4.1', 'o3', 'gpt-5', 'chatgpt-4o-latest']);
        expect(models[0]).toEqual({ id: 'gpt-4.1', name: 'gpt-4.1', capabilities: { webSearch: true, readUrls: false, temperature: true } });
        expect(models[0].inputTokenLimit).toBeUndefined();
        expect(calls[0].url).toBe('https://api.openai.com/v1/models');
        expect((calls[0].init.headers as Record<string, string>).Authorization).toBe(`Bearer ${KEY}`);
    });

    it('throws CANCELLED when aborted mid-stream', async () => {
        const ac = new AbortController();
        const enc = new TextEncoder();
        const fetchFn = (async () =>
            new Response(
                new ReadableStream({
                    start(c) {
                        c.enqueue(enc.encode('data: {"type":"response.output_text.delta","delta":"a"}\n\n'));
                        ac.signal.addEventListener('abort', () => c.error(new DOMException('aborted', 'AbortError')));
                    },
                }),
            )) as unknown as typeof fetch;
        const p = createOpenAiAdapter({ fetchFn }).stream(baseRequest, KEY, ac.signal, () => ac.abort());
        await expect(p).rejects.toMatchObject({ code: 'CANCELLED' });
    });
});
