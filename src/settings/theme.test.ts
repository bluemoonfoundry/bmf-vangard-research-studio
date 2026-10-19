import { describe, it, expect } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useTheme } from '@/settings/theme';
import { createFakeBridge } from '@/test/fakeBridge';

describe('useTheme', () => {
  it('is unavailable without a bridge', () => {
    const { result } = renderHook(() => useTheme(null));
    expect(result.current.available).toBe(false);
    expect(result.current.theme).toBeNull();
  });

  it('loads the stored theme', async () => {
    const { bridge, fake } = createFakeBridge();
    fake.theme = 'dark';
    const { result } = renderHook(() => useTheme(bridge.app));
    await waitFor(() => expect(result.current.theme).toBe('dark'));
  });

  it('setTheme stores the choice', async () => {
    const { bridge, fake } = createFakeBridge();
    const { result } = renderHook(() => useTheme(bridge.app));
    await waitFor(() => expect(result.current.theme).toBe('system'));
    await act(async () => {
      await result.current.setTheme('light');
    });
    expect(bridge.app.setTheme).toHaveBeenCalledWith('light');
    expect(fake.theme).toBe('light');
    expect(result.current.theme).toBe('light');
    expect(result.current.error).toBeNull();
  });

  it('a failed setTheme keeps the old theme and reports the error', async () => {
    const { bridge, fake } = createFakeBridge();
    fake.themeError = 'Disk full';
    const { result } = renderHook(() => useTheme(bridge.app));
    await waitFor(() => expect(result.current.theme).toBe('system'));
    await act(async () => {
      await result.current.setTheme('dark');
    });
    expect(result.current.theme).toBe('system');
    expect(result.current.error).toBe('Disk full');
  });
});
