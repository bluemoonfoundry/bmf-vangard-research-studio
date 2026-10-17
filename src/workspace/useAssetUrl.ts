import { useEffect, useState } from 'react';
import type { AssetCache } from '@/workspace/assetCache';

export type AssetUrlState =
  | { status: 'none' }
  | { status: 'loading' }
  | { status: 'ready'; url: string }
  | { status: 'error'; message: string };

/** An object URL for `asset`, reloaded when the file changes on disk. */
export function useAssetUrl(cache: AssetCache | null, asset: string | undefined): AssetUrlState {
  const [state, setState] = useState<{ asset?: string; version: number; value: AssetUrlState }>({
    version: 0,
    value: { status: 'none' },
  });
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (!cache || !asset) return;
    return cache.subscribe((changed) => {
      if (changed === asset) setVersion(v => v + 1);
    });
  }, [cache, asset]);

  useEffect(() => {
    if (!cache || !asset) return;
    let cancelled = false;
    cache.url(asset).then(
      (url) => { if (!cancelled) setState({ asset, version, value: { status: 'ready', url } }); },
      (err: unknown) => {
        if (!cancelled) {
          setState({ asset, version, value: { status: 'error', message: err instanceof Error ? err.message : String(err) } });
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [cache, asset, version]);

  if (!cache || !asset) return { status: 'none' };
  // Until the effect for the current asset/version settles, report loading rather than a stale URL.
  return state.asset === asset && state.version === version ? state.value : { status: 'loading' };
}
