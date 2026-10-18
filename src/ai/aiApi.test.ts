import { describe, it, expect, vi } from 'vitest';
import { createAiApi } from '@/ai/aiApi';
import { ProjectError } from '@/project/api';
import { createFakeBridge } from '@/test/fakeBridge';
import type { StreamEvent } from '@/ai/types';

describe('aiApi', () => {
  it('unwraps ok results and throws ProjectError on failure', async () => {
    const { bridge, fake } = createFakeBridge();
    const ai = createAiApi(bridge);

    expect(await ai.getSettings()).toEqual(fake.ai.status);
    expect((await ai.saveKey('gemini', 'sk-1')).providers.gemini.configured).toBe(true);
    expect(await ai.startChat('r1', {
      provider: 'gemini', model: 'm', system: '', messages: [{ role: 'user', text: 'Hi' }], webSearch: false, readUrls: false,
    })).toBe('r1');
    expect(fake.ai.startedChats).toHaveLength(1);

    bridge.ai.listModels.mockResolvedValueOnce({ ok: false, error: { code: 'AI_DISABLED', message: 'AI is turned off.' } });
    const failure = ai.listModels('gemini', { refresh: true });
    await expect(failure).rejects.toBeInstanceOf(ProjectError);
    await expect(failure).rejects.toMatchObject({ code: 'AI_DISABLED' });
  });

  it('passes chat events through', () => {
    const { bridge, fake } = createFakeBridge();
    const ai = createAiApi(bridge);
    const seen = vi.fn();
    const off = ai.onChatEvent(seen);
    const event: StreamEvent = { type: 'text', delta: 'x' };
    fake.ai.emitChatEvent('r1', event);
    off();
    fake.ai.emitChatEvent('r1', event);
    expect(seen).toHaveBeenCalledTimes(1);
    expect(seen).toHaveBeenCalledWith({ requestId: 'r1', event });
  });
});

describe('aiApi extraction', () => {
  it('unwraps extract and cancelExtract', async () => {
    const { bridge, fake } = createFakeBridge();
    const ai = createAiApi(bridge);
    fake.ai.extractResult = { proposals: [], summary: 's', dropped: 2, model: 'm' };
    const request = { provider: 'gemini' as const, model: 'm', system: 'sys', text: 'txt' };
    expect(await ai.extract('x1', request)).toEqual({ proposals: [], summary: 's', dropped: 2, model: 'm' });
    expect(fake.ai.extractions).toEqual([{ requestId: 'x1', request }]);
    await ai.cancelExtract('x1');
    expect(fake.ai.cancelledExtractions).toEqual(['x1']);
  });
});
