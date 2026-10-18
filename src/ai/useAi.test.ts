import { describe, it, expect } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useAi } from '@/ai/useAi';
import { createAiApi } from '@/ai/aiApi';
import { createFakeBridge } from '@/test/fakeBridge';

describe('useAi', () => {
  it('enabled is false while status loads', async () => {
    const { bridge, fake } = createFakeBridge();
    fake.ai.status.enabled = true;
    const api = createAiApi(bridge);
    const { result } = renderHook(() => useAi(api));
    expect(result.current.status).toBeNull();
    expect(result.current.enabled).toBe(false);
    await waitFor(() => expect(result.current.enabled).toBe(true));
  });

  it('adopts the status returned by saveKey and caches models', async () => {
    const { bridge, fake } = createFakeBridge();
    const api = createAiApi(bridge);
    const { result } = renderHook(() => useAi(api));
    await waitFor(() => expect(result.current.status).not.toBeNull());
    await act(async () => {
      await result.current.saveKey('openai', 'k');
    });
    expect(result.current.status?.providers.openai.configured).toBe(true);
    fake.ai.models.openai = [{ id: 'm1', name: 'M1', capabilities: { webSearch: false, readUrls: false, temperature: true } }];
    await act(async () => {
      await result.current.loadModels('openai');
    });
    expect(result.current.models('openai')?.[0].id).toBe('m1');
    await act(async () => {
      await result.current.saveKey('openai', 'k2');
    });
    expect(result.current.models('openai')).toBeUndefined();
  });

  it('keeps a per-provider model load error until a load succeeds, with a stable models()', async () => {
    const { bridge, fake } = createFakeBridge();
    bridge.ai.listModels.mockImplementationOnce(() => Promise.resolve({ ok: false, error: { code: 'NETWORK', message: 'Network is down' } }));
    const api = createAiApi(bridge);
    const { result, rerender } = renderHook(() => useAi(api));
    await waitFor(() => expect(result.current.status).not.toBeNull());
    const models = result.current.models;
    rerender();
    expect(result.current.models).toBe(models);

    await act(async () => {
      await result.current.loadModels('gemini');
    });
    expect(result.current.modelsError('gemini')).toBe('Network is down');
    expect(result.current.modelsError('openai')).toBeNull();
    expect(result.current.models('gemini')).toBeUndefined();

    fake.ai.models.gemini = [{ id: 'g1', name: 'G1', capabilities: { webSearch: true, readUrls: true, temperature: true } }];
    await act(async () => {
      await result.current.loadModels('gemini', true);
    });
    expect(result.current.modelsError('gemini')).toBeNull();
    expect(result.current.models('gemini')?.[0].id).toBe('g1');
  });
});
