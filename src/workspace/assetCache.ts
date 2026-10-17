/**
 * Object URLs for project assets. Bytes come from the main process
 * (project:read-asset) and are shown through blob: URLs, which the CSP allows
 * for images and media; the renderer never loads files by path.
 */

const MIME_TYPES: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
  avif: 'image/avif', bmp: 'image/bmp',
  mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', oga: 'audio/ogg', opus: 'audio/ogg',
  m4a: 'audio/mp4', aac: 'audio/aac', flac: 'audio/flac',
};

export function mimeTypeOf(asset: string): string {
  return MIME_TYPES[asset.split('.').pop()?.toLowerCase() ?? ''] ?? 'application/octet-stream';
}

export interface AssetCache {
  /** Resolves to an object URL for the asset, reading it once and sharing it between callers. */
  url(asset: string): Promise<string>;
  /** Forgets an asset (changed on disk), so the next url() re-reads it. */
  invalidate(asset: string): void;
  /** Calls `listener` with the asset name whenever it is invalidated. */
  subscribe(listener: (asset: string) => void): () => void;
  /** Revokes every URL (project closed). */
  clear(): void;
}

export function createAssetCache(
  read: (asset: string) => Promise<Uint8Array>,
  urls: Pick<typeof URL, 'createObjectURL' | 'revokeObjectURL'> = URL,
): AssetCache {
  const entries = new Map<string, Promise<string>>();
  const listeners = new Set<(asset: string) => void>();

  const revoke = (pending: Promise<string> | undefined) => {
    pending?.then(u => urls.revokeObjectURL(u), () => {});
  };

  return {
    url(asset) {
      let pending = entries.get(asset);
      if (!pending) {
        pending = read(asset).then(bytes => urls.createObjectURL(new Blob([bytes as BlobPart], { type: mimeTypeOf(asset) })));
        // A failed read isn't cached: the file may appear later (e.g. a sync client catching up).
        pending.catch(() => entries.delete(asset));
        entries.set(asset, pending);
      }
      return pending;
    },
    invalidate(asset) {
      revoke(entries.get(asset));
      entries.delete(asset);
      listeners.forEach(l => l(asset));
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    clear() {
      entries.forEach(revoke);
      entries.clear();
    },
  };
}
