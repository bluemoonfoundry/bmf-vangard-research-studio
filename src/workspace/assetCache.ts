/**
 * URLs for project assets. The main process streams them over the vrs-asset:
 * scheme (electron/lib/assetProtocol.js), with range requests, so long audio
 * never crosses IPC whole; the CSP allows the scheme for images and media only.
 * The URL names an asset, never a path. Before handing one out the cache asks
 * main (project:check-asset) whether the file exists, so a missing file is
 * reported with a message instead of a silently broken element.
 */

/** Must match ASSET_SCHEME and assetUrl() in electron/lib/assetProtocol.js. */
export function assetUrl(asset: string, version: number): string {
  return `vrs-asset://project/${encodeURIComponent(asset)}?v=${version}`;
}

export interface AssetCache {
  /** Resolves to a URL for the asset, checking it once and sharing it between callers. */
  url(asset: string): Promise<string>;
  /** Forgets an asset (changed on disk), so the next url() checks it again and gives a fresh URL. */
  invalidate(asset: string): void;
  /** Calls `listener` with the asset name whenever it is invalidated. */
  subscribe(listener: (asset: string) => void): () => void;
  /** Forgets every asset (project closed). */
  clear(): void;
}

export function createAssetCache(check: (asset: string) => Promise<unknown>): AssetCache {
  const entries = new Map<string, Promise<string>>();
  // Bumped per asset on every change, so <img>/<audio> elements reload instead of reusing what they had.
  const versions = new Map<string, number>();
  const listeners = new Set<(asset: string) => void>();

  return {
    url(asset) {
      let pending = entries.get(asset);
      if (!pending) {
        pending = check(asset).then(() => assetUrl(asset, versions.get(asset) ?? 0));
        // A failed check isn't cached: the file may appear later (e.g. a sync client catching up).
        pending.catch(() => entries.delete(asset));
        entries.set(asset, pending);
      }
      return pending;
    },
    invalidate(asset) {
      versions.set(asset, (versions.get(asset) ?? 0) + 1);
      entries.delete(asset);
      listeners.forEach(l => l(asset));
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    clear() {
      entries.clear();
    },
  };
}
