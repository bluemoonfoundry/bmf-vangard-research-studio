import { describe, it, expect, vi } from 'vitest';
import { createLlmService, MAX_REQUEST_CHARS } from './llmService.js';
import { LlmError } from './http.js';

vi.mock('../logger.main.js', () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() } }));

type Provider = 'gemini' | 'anthropic' | 'openai';
type Event = { type: string; [k: string]: unknown };
const IDS: Provider[] = ['gemini', 'anthropic', 'openai'];
const GOOD = 'sk-good-123456';
const NOW = '2026-10-17T12:00:00.000Z';

function fakeSettings() {
    let state = {
        ai: {
            enabled: false,
            defaultProvider: null as Provider | null,
            defaultModel: null as string | null,
            providers: Object.fromEntries(IDS.map(id => [id, { lastTestOk: null as string | null }])) as Record<Provider, { lastTestOk: string | null }>,
        },
    };
    return {
        read: async () => structuredClone(state),
        update: async (fn: (s: typeof state) => typeof state) => {
            state = fn(structuredClone(state));
            return structuredClone(state);
        },
        get state() {
            return state;
        },
    };
}

function fakeKeys() {
    const stored = new Map<string, string>();
    const store = {
        broken: false,
        stored,
        available: () => true,
        check() {
            if (store.broken) throw Object.assign(new Error('The key store is corrupt.'), { code: 'CORRUPT' });
        },
        has: async (p: string) => (store.check(), stored.has(p)),
        get: async (p: string) => (store.check(), stored.get(p) ?? null),
        set: vi.fn(async (p: string, k: string) => {
            store.check();
            stored.set(p, k);
        }),
        remove: async (p: string) => {
            store.check();
            stored.delete(p);
        },
    };
    return store;
}

type StreamImpl = (req: unknown, key: string, signal: AbortSignal, onEvent: (e: Event) => void) => Promise<void>;

function fakeAdapter(id: Provider) {
    return {
        id,
        listModels: vi.fn(async (key: string) => {
            if (key !== GOOD) throw new LlmError('AUTH', 'Invalid API key.');
            return [{ id: `${id}-model`, name: `${id} model`, capabilities: { webSearch: true, readUrls: true, temperature: true } }];
        }),
        capabilities: () => ({ webSearch: true, readUrls: true, temperature: true }),
        stream: vi.fn<StreamImpl>(async (_req, _key, _signal, onEvent) => {
            onEvent({ type: 'text', delta: 'Hel' });
            onEvent({ type: 'text', delta: 'lo' });
            onEvent({ type: 'done', model: `${id}-model` });
        }),
    };
}

/** An adapter stream that only ends when its signal aborts. */
const waitForAbort: StreamImpl = (_req, _key, signal) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(new LlmError('CANCELLED', 'Request cancelled.')));
});

function setup() {
    const settings = fakeSettings();
    const keys = fakeKeys();
    const adapters = { gemini: fakeAdapter('gemini'), anthropic: fakeAdapter('anthropic'), openai: fakeAdapter('openai') };
    const events: { requestId: string; event: Event }[] = [];
    const emit = (requestId: string, event: Event) => events.push({ requestId, event });
    const service = createLlmService({ settings, keys, adapters, emit, now: () => NOW });
    return { settings, keys, adapters, events, service };
}

async function enabled() {
    const ctx = setup();
    await ctx.service.saveKey('gemini', GOOD);
    await ctx.service.setSettings({ enabled: true });
    return ctx;
}

const request = (overrides: Record<string, unknown> = {}) => ({
    provider: 'gemini',
    model: 'gemini-model',
    system: 'You are helpful.',
    messages: [{ role: 'user', text: 'Hi' }],
    webSearch: false,
    readUrls: false,
    ...overrides,
});

async function codeOf(p: Promise<unknown>) {
    try {
        await p;
    } catch (e) {
        return (e as { code?: string }).code;
    }
    throw new Error('did not throw');
}

describe('llmService', () => {
    it('refuses every llm channel while disabled', async () => {
        const { service } = setup();
        expect(await codeOf(service.listModels('gemini', { refresh: false }))).toBe('AI_DISABLED');
        expect(await codeOf(service.startChat('r1', request()))).toBe('AI_DISABLED');
        expect(await codeOf(service.cancel('r1'))).toBe('AI_DISABLED');
        expect(await codeOf(service.cancelAll())).toBe('AI_DISABLED');
        // Key management stays available so AI can be set up.
        await expect(service.saveKey('gemini', GOOD)).resolves.toBeDefined();
        await expect(service.testKey('gemini')).resolves.toBeDefined();
        await expect(service.removeKey('gemini')).resolves.toBeDefined();
    });

    it('abortAll never refuses, even while disabled', async () => {
        const { service } = setup();
        expect(() => service.abortAll()).not.toThrow();
    });

    it('saveKey stores only after a successful test', async () => {
        const { service, keys, adapters, settings } = setup();
        const status = await service.saveKey('gemini', `  ${GOOD}\n`);
        expect(adapters.gemini.listModels).toHaveBeenCalledWith(GOOD, expect.anything());
        expect(keys.stored.get('gemini')).toBe(GOOD);
        expect(settings.state.ai.providers.gemini.lastTestOk).toBe(NOW);
        expect(status.providers.gemini).toEqual({ configured: true, lastTestOk: NOW });
    });

    it('failed test stores nothing and rethrows AUTH', async () => {
        const { service, keys, settings } = setup();
        expect(await codeOf(service.saveKey('gemini', 'sk-bad'))).toBe('AUTH');
        expect(keys.set).not.toHaveBeenCalled();
        expect(keys.stored.size).toBe(0);
        expect(settings.state.ai.providers.gemini.lastTestOk).toBeNull();
    });

    it('cannot enable without a tested provider', async () => {
        const { service, keys, settings } = setup();
        expect(await codeOf(service.setSettings({ enabled: true }))).toBe('INVALID');
        // A stored key whose last test did not succeed is not enough either.
        keys.stored.set('openai', GOOD);
        expect(await codeOf(service.setSettings({ enabled: true }))).toBe('INVALID');
        expect(settings.state.ai.enabled).toBe(false);
        await service.testKey('openai');
        expect((await service.setSettings({ enabled: true })).enabled).toBe(true);
    });

    it('rejects unknown or mistyped settings fields', async () => {
        const { service } = setup();
        expect(await codeOf(service.setSettings({ enabled: 'yes' }))).toBe('INVALID');
        expect(await codeOf(service.setSettings({ defaultProvider: 'cohere' }))).toBe('INVALID');
        expect(await codeOf(service.setSettings({ apiKey: 'x' }))).toBe('INVALID');
        const status = await service.setSettings({ defaultProvider: 'anthropic', defaultModel: 'claude-x' });
        expect(status).toMatchObject({ defaultProvider: 'anthropic', defaultModel: 'claude-x' });
    });

    it('disabling cancels in-flight chats', async () => {
        const { service, adapters, events } = await enabled();
        adapters.gemini.stream.mockImplementation(waitForAbort);
        await service.startChat('r1', request());
        await service.setSettings({ enabled: false });
        await vi.waitFor(() => expect(events).toEqual([{ requestId: 'r1', event: { type: 'error', code: 'CANCELLED', message: 'Cancelled' } }]));
        // The adapter's own CANCELLED rejection does not produce a second terminal event.
        await new Promise(r => setTimeout(r, 0));
        expect(events).toHaveLength(1);
    });

    it('cancel aborts one chat', async () => {
        const { service, adapters, events } = await enabled();
        adapters.gemini.stream.mockImplementation(waitForAbort);
        await service.startChat('r1', request());
        await service.startChat('r2', request());
        await service.cancel('r1');
        expect(events).toEqual([{ requestId: 'r1', event: { type: 'error', code: 'CANCELLED', message: 'Cancelled' } }]);
        await service.cancelAll();
        expect(events.map(e => e.requestId)).toEqual(['r1', 'r2']);
    });

    it('removing the last configured key turns AI off', async () => {
        const { service, settings } = await enabled();
        const status = await service.removeKey('gemini');
        expect(settings.state.ai.enabled).toBe(false);
        expect(status.enabled).toBe(false);
        expect(status.providers.gemini).toEqual({ configured: false, lastTestOk: null });
    });

    it('status never includes key material', async () => {
        const { service } = await enabled();
        const status = await service.getStatus();
        expect(JSON.stringify(status)).not.toContain(GOOD);
        expect(status).toEqual({
            enabled: true,
            defaultProvider: null,
            defaultModel: null,
            encryptionAvailable: true,
            providers: {
                gemini: { configured: true, lastTestOk: NOW },
                anthropic: { configured: false, lastTestOk: null },
                openai: { configured: false, lastTestOk: null },
            },
            keyStoreProblem: null,
        });
    });

    it('status survives a corrupt key store', async () => {
        const { service, keys } = await enabled();
        keys.broken = true;
        const status = await service.getStatus();
        for (const id of IDS) expect(status.providers[id].configured).toBe(false);
        expect(status.keyStoreProblem).toEqual(expect.any(String));
        expect(status.keyStoreProblem).not.toContain(GOOD);
    });

    it('streams adapter events to emit in order', async () => {
        const { service, adapters, events } = await enabled();
        expect(await service.startChat('r1', request({ temperature: 0.5, extra: 'dropped' }))).toBe('r1');
        await vi.waitFor(() => expect(events).toHaveLength(3));
        expect(events).toEqual([
            { requestId: 'r1', event: { type: 'text', delta: 'Hel' } },
            { requestId: 'r1', event: { type: 'text', delta: 'lo' } },
            { requestId: 'r1', event: { type: 'done', model: 'gemini-model' } },
        ]);
        expect(adapters.gemini.stream.mock.calls[0][0]).toEqual({ ...request(), temperature: 0.5 });
        expect(adapters.gemini.stream.mock.calls[0][1]).toBe(GOOD);
    });

    it('adapter throw becomes a scrubbed error event', async () => {
        const { service, adapters, events } = await enabled();
        adapters.gemini.stream.mockImplementation(async () => {
            throw new LlmError('RATE_LIMIT', `Slow down, ${GOOD}`);
        });
        await service.startChat('r1', request());
        await vi.waitFor(() => expect(events).toHaveLength(1));
        expect(events[0].event).toEqual({ type: 'error', code: 'RATE_LIMIT', message: 'Slow down, [redacted]' });
    });

    it('a stream that ends without done reports an error', async () => {
        const { service, adapters, events } = await enabled();
        adapters.gemini.stream.mockImplementation(async (_r, _k, _s, onEvent) => onEvent({ type: 'text', delta: 'x' }));
        await service.startChat('r1', request());
        await vi.waitFor(() => expect(events).toHaveLength(2));
        expect(events[1].event).toMatchObject({ type: 'error', code: 'PROVIDER' });
    });

    it('rejects oversized requests', async () => {
        const { service, adapters } = await enabled();
        const big = 'x'.repeat(MAX_REQUEST_CHARS);
        expect(await codeOf(service.startChat('r1', request({ messages: [{ role: 'user', text: big }] })))).toBe('INVALID');
        expect(adapters.gemini.stream).not.toHaveBeenCalled();
    });

    it('rejects malformed requests and unconfigured providers', async () => {
        const { service } = await enabled();
        expect(await codeOf(service.startChat('r1', request({ messages: [{ role: 'system', text: 'x' }] })))).toBe('INVALID');
        expect(await codeOf(service.startChat('r1', request({ webSearch: 'yes' })))).toBe('INVALID');
        expect(await codeOf(service.startChat('r1', request({ provider: 'anthropic' })))).toBe('INVALID');
    });

    it('rejects an invalid requestId', async () => {
        const { service, adapters } = await enabled();
        expect(await codeOf(service.startChat('../evil', request()))).toBe('INVALID');
        expect(await codeOf(service.startChat(42 as unknown as string, request()))).toBe('INVALID');
        adapters.gemini.stream.mockImplementation(waitForAbort);
        await service.startChat('r1', request());
        expect(await codeOf(service.startChat('r1', request()))).toBe('INVALID');
    });

    it('caches model lists until refresh or a key change', async () => {
        const { service, adapters } = await enabled();
        // saveKey's test call primed the cache.
        expect(await service.listModels('gemini', { refresh: false })).toHaveLength(1);
        expect(adapters.gemini.listModels).toHaveBeenCalledTimes(1);
        await service.listModels('gemini', { refresh: true });
        expect(adapters.gemini.listModels).toHaveBeenCalledTimes(2);
        await service.listModels('gemini', { refresh: false });
        expect(adapters.gemini.listModels).toHaveBeenCalledTimes(2);
    });
});
