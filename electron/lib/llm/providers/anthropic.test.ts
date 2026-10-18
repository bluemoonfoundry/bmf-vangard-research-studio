import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createAnthropicAdapter } from './anthropic.js';

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
    provider: 'anthropic',
    model: 'claude-sonnet-4-5-20250929',
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

async function run(over: Partial<typeof baseRequest> & { jsonSchema?: object; maxOutputTokens?: number }, responses: { body: string; status?: number; type?: string }[] = [{ body: fixture('anthropic-text.txt') }]) {
    const { calls, fetchFn } = fakeFetch(responses);
    const events: StreamEvent[] = [];
    await createAnthropicAdapter({ fetchFn }).stream({ ...baseRequest, ...over }, KEY, new AbortController().signal, (e: StreamEvent) => events.push(e));
    return { calls, events, body: JSON.parse(String(calls[0].init.body)) };
}

describe('anthropic adapter', () => {
    it('sends x-api-key and anthropic-version', async () => {
        const { calls } = await run({});
        expect(calls[0].url).toBe('https://api.anthropic.com/v1/messages');
        const h = calls[0].init.headers as Record<string, string>;
        expect(h['x-api-key']).toBe(KEY);
        expect(h['anthropic-version']).toBe('2023-06-01');
        expect(h['anthropic-beta']).toBeUndefined();
    });

    it('maps system and messages', async () => {
        const { body } = await run({ temperature: 0.4 });
        expect(body).toMatchObject({ stream: true, max_tokens: 8192, system: 'Be brief.', temperature: 0.4, model: baseRequest.model });
        expect(body.messages).toEqual([
            { role: 'user', content: 'Hi' },
            { role: 'assistant', content: 'Hello' },
            { role: 'user', content: 'Again' },
        ]);
        const { body: b2 } = await run({ temperature: null, system: '' });
        expect(b2.temperature).toBeUndefined();
        expect(b2.system).toBeUndefined();
    });

    it('clamps temperature to the 0–1 range Anthropic accepts', async () => {
        expect((await run({ temperature: 1.7 })).body.temperature).toBe(1);
        expect((await run({ temperature: 1 })).body.temperature).toBe(1);
        expect((await run({ temperature: 0 })).body.temperature).toBe(0);
    });

    it('adds web search / web fetch tools only when toggled', async () => {
        expect((await run({})).body.tools).toBeUndefined();
        expect((await run({ webSearch: true })).body.tools).toEqual([{ type: 'web_search_20250305', name: 'web_search' }]);
        expect((await run({ readUrls: true })).body.tools).toEqual([{ type: 'web_fetch_20250910', name: 'web_fetch' }]);
        expect((await run({ webSearch: true, readUrls: true })).body.tools).toHaveLength(2);
    });

    it('streams text deltas then done with model and usage', async () => {
        const { events } = await run({});
        expect(events).toEqual([
            { type: 'text', delta: 'Hel' },
            { type: 'text', delta: 'lo' },
            { type: 'done', model: 'claude-sonnet-4-5-20250929', usage: { inputTokens: 12, outputTokens: 5 } },
        ]);
    });

    it('collects sources from search results and citations', async () => {
        const { events } = await run({ webSearch: true }, [{ body: fixture('anthropic-search.txt') }]);
        expect(events.map((e) => e.type)).toEqual(['text', 'text', 'sources', 'done']);
        expect(events[2].sources).toEqual([
            { title: 'Euro rate', url: 'https://example.com/euro' },
            { title: 'Final news', url: 'https://news.example.org/final' },
            { title: 'Cited page', url: 'https://cited.example.net/page' },
        ]);
        expect(events[3].usage).toEqual({ inputTokens: 30, outputTokens: 40 });
    });

    it('collects the url of a web fetch result and ignores error results', async () => {
        const body = [
            'data: {"type":"content_block_start","index":1,"content_block":{"type":"web_fetch_tool_result","tool_use_id":"s","content":{"type":"web_fetch_result","url":"https://example.com/a","content":{"type":"document","title":"Doc A","source":{"type":"text","media_type":"text/plain","data":"x"}}}}}',
            'data: {"type":"content_block_start","index":2,"content_block":{"type":"web_search_tool_result","tool_use_id":"s","content":{"type":"web_search_tool_result_error","error_code":"unavailable"}}}',
            '',
        ].join('\n\n');
        const { events } = await run({ readUrls: true }, [{ body }]);
        expect(events[0]).toEqual({ type: 'sources', sources: [{ title: 'Doc A', url: 'https://example.com/a' }] });
    });

    it('throws PROVIDER on an SSE error event and scrubs the key', async () => {
        const body = `event: error\ndata: {"type":"error","error":{"type":"overloaded_error","message":"busy key=${KEY} ${KEY}"}}\n\n`;
        const err = await run({}, [{ body }]).catch((e) => e);
        expect(err.name).toBe('LlmError');
        expect(err.code).toBe('PROVIDER');
        expect(err.message).not.toContain(KEY);
        expect(err.message).toContain('[redacted]');
    });

    it('throws AUTH on 401 without leaking the key', async () => {
        await expect(run({}, [{ body: fixture('anthropic-error.txt'), status: 401, type: 'application/json' }])).rejects.toMatchObject({
            name: 'LlmError',
            code: 'AUTH',
            message: expect.not.stringContaining(KEY),
        });
    });

    it('lists models across pages', async () => {
        const page1 = {
            data: [
                { id: 'claude-opus-5-5', display_name: 'Claude Opus 5.5', max_input_tokens: 1000000, capabilities: { server_tools: { web_search: { supported: true } } } },
                { id: 'claude-3-haiku-20240307', display_name: 'Claude Haiku 3', max_input_tokens: 200000 },
            ],
            has_more: true,
            last_id: 'claude-3-haiku-20240307',
        };
        const page2 = { data: [{ id: 'claude-3-opus-20240229', display_name: 'Claude Opus 3', max_input_tokens: null }], has_more: false, last_id: 'claude-3-opus-20240229' };
        const { calls, fetchFn } = fakeFetch([
            { body: JSON.stringify(page1), type: 'application/json' },
            { body: JSON.stringify(page2), type: 'application/json' },
        ]);
        const models = await createAnthropicAdapter({ fetchFn }).listModels(KEY, new AbortController().signal);
        expect(models.map((m) => m.id)).toEqual(['claude-opus-5-5', 'claude-3-haiku-20240307', 'claude-3-opus-20240229']);
        expect(models[0]).toMatchObject({ name: 'Claude Opus 5.5', inputTokenLimit: 1000000, capabilities: { webSearch: true, readUrls: true, temperature: true } });
        expect(models[1].capabilities.webSearch).toBe(false);
        expect(models[2].inputTokenLimit).toBeUndefined();
        expect(calls[0].url).not.toContain('after_id');
        expect(calls[1].url).toContain('after_id=claude-3-haiku-20240307');
        expect((calls[1].init.headers as Record<string, string>)['x-api-key']).toBe(KEY);
    });

    it('derives capabilities from the model id', () => {
        const a = createAnthropicAdapter({});
        expect(a.capabilities('claude-sonnet-4-5-20250929').webSearch).toBe(true);
        expect(a.capabilities('claude-opus-5-5').readUrls).toBe(true);
        expect(a.capabilities('claude-3-7-sonnet-20250219').webSearch).toBe(true);
        expect(a.capabilities('claude-3-haiku-20240307')).toEqual({ webSearch: false, readUrls: false, temperature: true });
        expect(a.capabilities('claude-opus-3-foo').webSearch).toBe(false);
    });

    it('throws CANCELLED when aborted mid-stream', async () => {
        const ac = new AbortController();
        const enc = new TextEncoder();
        const fetchFn = (async () =>
            new Response(
                new ReadableStream({
                    start(c) {
                        c.enqueue(enc.encode('data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"a"}}\n\n'));
                        ac.signal.addEventListener('abort', () => c.error(new DOMException('aborted', 'AbortError')));
                    },
                }),
            )) as unknown as typeof fetch;
        const p = createAnthropicAdapter({ fetchFn }).stream(baseRequest, KEY, ac.signal, () => ac.abort());
        await expect(p).rejects.toMatchObject({ code: 'CANCELLED' });
    });
});

describe('anthropic structured output', () => {
    const schema = { type: 'object', properties: { a: { type: 'string' } }, required: ['a'], additionalProperties: false };

    it('asks for JSON matching the schema with the requested output budget', async () => {
        const { body } = await run({ jsonSchema: schema, maxOutputTokens: 32000 });
        expect(body.output_config).toEqual({ format: { type: 'json_schema', schema } });
        expect(body.max_tokens).toBe(32000);
    });

    it('leaves the body alone without a schema', async () => {
        const { body } = await run({});
        expect(body.output_config).toBeUndefined();
        expect(body.max_tokens).toBe(8192);
    });
});
