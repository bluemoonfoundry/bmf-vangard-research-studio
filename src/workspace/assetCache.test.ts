import { describe, it, expect, vi } from 'vitest';
import { assetUrl, createAssetCache } from '@/workspace/assetCache';

describe('assetUrl', () => {
  it('names the asset on the vrs-asset scheme with a version', () => {
    expect(assetUrl('tape.mp3', 2)).toBe('vrs-asset://project/tape.mp3?v=2');
  });
});

describe('createAssetCache', () => {
  it('checks an asset once and shares its URL', async () => {
    const check = vi.fn(() => Promise.resolve());
    const cache = createAssetCache(check);
    const [a, b] = await Promise.all([cache.url('tape.mp3'), cache.url('tape.mp3')]);
    expect(a).toBe('vrs-asset://project/tape.mp3?v=0');
    expect(b).toBe(a);
    expect(check).toHaveBeenCalledTimes(1);
  });

  it('reports a missing asset and checks again next time', async () => {
    const check = vi.fn()
      .mockRejectedValueOnce(new Error('tape.mp3 is missing'))
      .mockResolvedValueOnce(undefined);
    const cache = createAssetCache(check);
    await expect(cache.url('tape.mp3')).rejects.toThrow('tape.mp3 is missing');
    await expect(cache.url('tape.mp3')).resolves.toBe('vrs-asset://project/tape.mp3?v=0');
    expect(check).toHaveBeenCalledTimes(2);
  });

  it('hands out a new URL after an asset changes on disk, and tells subscribers', async () => {
    const check = vi.fn(() => Promise.resolve());
    const cache = createAssetCache(check);
    const listener = vi.fn();
    const unsubscribe = cache.subscribe(listener);
    await cache.url('tape.mp3');

    cache.invalidate('tape.mp3');
    expect(listener).toHaveBeenCalledWith('tape.mp3');
    await expect(cache.url('tape.mp3')).resolves.toBe('vrs-asset://project/tape.mp3?v=1');
    expect(check).toHaveBeenCalledTimes(2);

    unsubscribe();
    cache.invalidate('tape.mp3');
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('forgets everything on clear', async () => {
    const check = vi.fn(() => Promise.resolve());
    const cache = createAssetCache(check);
    await cache.url('a.png');
    cache.clear();
    await cache.url('a.png');
    expect(check).toHaveBeenCalledTimes(2);
  });
});
