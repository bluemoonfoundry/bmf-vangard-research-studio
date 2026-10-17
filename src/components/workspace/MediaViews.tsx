import { useEffect, useRef, useState } from 'react';
import { ExternalLink, Maximize2, Pause, Play, RotateCcw, ZoomIn, ZoomOut } from 'lucide-react';
import type { TreeItem } from '@/project/types';
import type { AssetCache } from '@/workspace/assetCache';
import { useAssetUrl } from '@/workspace/useAssetUrl';
import { btn, btnGhost, segment, segmentGroup } from '@/components/workspace/ui';

function AssetProblem({ status, message }: { status: 'loading' | 'error'; message?: string }) {
  return (
    <p className="p-6 text-center text-xs text-content-muted" role={status === 'error' ? 'alert' : undefined}>
      {status === 'loading' ? 'Loading…' : `Couldn't load this file: ${message}`}
    </p>
  );
}

/** An imported image with zoom controls. */
export function ImageViewer({ item, assets }: { item: TreeItem; assets: AssetCache | null }) {
  const state = useAssetUrl(assets, item.asset);
  const [zoom, setZoom] = useState(1);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const alt = item.mediaAlt || item.title;

  return (
    <figure className="overflow-hidden rounded-lg border border-line bg-surface-raised">
      <div className="flex items-center justify-between border-b border-line px-3 py-1.5 text-xs text-content-muted">
        <span>{size ? `${size.w} × ${size.h} px` : 'Image'}</span>
        <div className="flex items-center gap-1">
          <button type="button" className={btnGhost} aria-label="Zoom out" onClick={() => setZoom(z => Math.max(0.25, z - 0.25))}>
            <ZoomOut className="h-3.5 w-3.5" />
          </button>
          <span className="w-10 text-center font-mono tabular-nums" aria-live="polite">{Math.round(zoom * 100)}%</span>
          <button type="button" className={btnGhost} aria-label="Zoom in" onClick={() => setZoom(z => Math.min(4, z + 0.25))}>
            <ZoomIn className="h-3.5 w-3.5" />
          </button>
          <button type="button" className={btnGhost} aria-label="Reset zoom" onClick={() => setZoom(1)}>
            <Maximize2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
      <div className="flex max-h-[520px] items-center justify-center overflow-auto bg-surface-sunken p-4">
        {state.status === 'ready' ? (
          <img
            src={state.url}
            alt={alt}
            onLoad={(e) => setSize({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
            style={{ width: size ? size.w * zoom : undefined, maxWidth: zoom === 1 ? '100%' : 'none' }}
            className="rounded shadow"
          />
        ) : state.status === 'none' ? null : (
          <AssetProblem status={state.status} message={state.status === 'error' ? state.message : undefined} />
        )}
      </div>
      {item.mediaMetadata && (item.mediaMetadata.sourceDomain || item.mediaMetadata.year || item.mediaMetadata.archivalRefNumber) && (
        <figcaption className="flex flex-wrap gap-4 border-t border-line px-3 py-1.5 text-[11px] text-content-muted">
          {item.mediaMetadata.sourceDomain && <span>Source: {item.mediaMetadata.sourceDomain}</span>}
          {item.mediaMetadata.year && <span>Year: {item.mediaMetadata.year}</span>}
          {item.mediaMetadata.archivalRefNumber && <span>Ref: {item.mediaMetadata.archivalRefNumber}</span>}
        </figcaption>
      )}
    </figure>
  );
}

const formatTime = (seconds: number) => {
  if (!Number.isFinite(seconds)) return '--:--';
  const s = Math.floor(seconds);
  const h = Math.floor(s / 3600);
  const mm = String(Math.floor((s % 3600) / 60)).padStart(h ? 2 : 1, '0');
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
};

const SPEEDS = [0.75, 1, 1.25, 1.5, 2];

/** Plays an imported audio file. */
export function AudioPlayer({ item, assets }: { item: TreeItem; assets: AssetCache | null }) {
  const state = useAssetUrl(assets, item.asset);
  const audio = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(NaN);
  const [speed, setSpeed] = useState(1);
  const url = state.status === 'ready' ? state.url : undefined;

  useEffect(() => {
    setPlaying(false);
    setTime(0);
    setDuration(NaN);
  }, [url]);

  useEffect(() => {
    if (audio.current) audio.current.playbackRate = speed;
  }, [speed, url]);

  const toggle = () => {
    const el = audio.current;
    if (!el) return;
    if (el.paused) void el.play().catch(() => setPlaying(false));
    else el.pause();
  };

  return (
    <section aria-label="Audio player" className="rounded-lg border border-line bg-surface-raised p-4">
      {state.status === 'ready' ? (
        <>
          <audio
            ref={audio}
            src={url}
            preload="metadata"
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            onEnded={() => setPlaying(false)}
            onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
            onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
          />
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={toggle}
              aria-label={playing ? 'Pause' : 'Play'}
              className="flex h-9 w-9 items-center justify-center rounded-full bg-accent text-on-accent hover:opacity-90"
            >
              {playing ? <Pause className="h-4 w-4" /> : <Play className="ml-0.5 h-4 w-4" />}
            </button>
            <button
              type="button"
              className={btnGhost}
              aria-label="Back to start"
              onClick={() => {
                if (audio.current) audio.current.currentTime = 0;
              }}
            >
              <RotateCcw className="h-3.5 w-3.5" />
            </button>
            <input
              type="range"
              aria-label="Position"
              className="flex-1 accent-[var(--vrs-accent)]"
              min={0}
              max={Number.isFinite(duration) ? duration : 0}
              step={0.1}
              value={time}
              disabled={!Number.isFinite(duration)}
              onChange={(e) => {
                if (audio.current) audio.current.currentTime = Number(e.target.value);
              }}
            />
            <span className="font-mono text-[11px] tabular-nums text-content-muted">
              {formatTime(time)} / {formatTime(duration)}
            </span>
          </div>
          <div className="mt-3 flex justify-end">
            <div className={segmentGroup} role="group" aria-label="Playback speed">
              {SPEEDS.map(s => (
                <button key={s} type="button" className={segment(speed === s)} aria-pressed={speed === s} onClick={() => setSpeed(s)}>
                  {s}×
                </button>
              ))}
            </div>
          </div>
        </>
      ) : state.status === 'none' ? null : (
        <AssetProblem status={state.status} message={state.status === 'error' ? state.message : undefined} />
      )}
    </section>
  );
}

const isWebUrl = (url: string | undefined): url is string => {
  if (!url) return false;
  try {
    const { protocol } = new URL(url);
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
};

/** Source line for a web clipping, with a button that opens it in the system browser. */
export function WebClipBanner({ item, onOpenLink }: { item: TreeItem; onOpenLink(url: string): void }) {
  const { url } = item;
  const meta = item.mediaMetadata;
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-line bg-surface-raised p-3 text-xs">
      <div className="min-w-0">
        <div className="font-semibold">Web clipping</div>
        <div className="truncate text-content-muted" title={url}>
          {url || 'No source URL'}
          {meta?.author ? ` · ${meta.author}` : ''}
        </div>
      </div>
      <button type="button" className={btn} disabled={!isWebUrl(url)} onClick={() => isWebUrl(url) && onOpenLink(url)}>
        <ExternalLink className="h-3.5 w-3.5" />
        Open in browser
      </button>
    </div>
  );
}
