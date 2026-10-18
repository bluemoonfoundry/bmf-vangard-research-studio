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
});
