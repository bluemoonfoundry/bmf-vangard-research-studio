import { ExternalLink, X } from 'lucide-react';
import type { TreeItem } from '@/project/types';
import type { AssetCache } from '@/workspace/assetCache';
import { NO_LABEL_COLOR, itemType, labelOf } from '@/workspace/research';
import { useAssetUrl } from '@/workspace/useAssetUrl';
import { MarkdownView } from '@/components/workspace/MarkdownView';
import { btnGhost } from '@/components/workspace/ui';

interface QuickRefPanelProps {
  /** The live item (looked up by id on every render, so edits show immediately). */
  item: TreeItem;
  content: string | undefined;
  assets: AssetCache | null;
  onOpen(id: string): void;
  onClose(): void;
  onOpenLink(url: string): void;
}

function Picture({ item, assets }: { item: TreeItem; assets: AssetCache | null }) {
  const state = useAssetUrl(assets, item.asset);
  return state.status === 'ready'
    ? <img src={state.url} alt={item.mediaAlt || item.title} className="max-h-48 w-full rounded border border-line object-cover" />
    : null;
}

/** A floating, read-only view of one item, for reference while writing elsewhere. */
export function QuickRefPanel({ item, content, assets, onOpen, onClose, onOpenLink }: QuickRefPanelProps) {
  const label = labelOf(item);
  return (
    <section
      aria-label={`Quick reference: ${item.title || 'Untitled'}`}
      className="fixed bottom-6 right-6 z-40 flex max-h-[560px] w-[420px] flex-col overflow-hidden rounded-lg border border-line bg-surface-raised shadow-2xl"
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose();
      }}
    >
      <div className="flex items-center justify-between gap-2 border-b border-line bg-surface-sunken px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: label?.color ?? NO_LABEL_COLOR }} aria-hidden />
          <h2 className="truncate font-serif text-xs font-bold">{item.title || 'Untitled'}</h2>
        </div>
        <div className="flex shrink-0 items-center">
          <button type="button" className={btnGhost} aria-label="Open in editor" title="Open in editor" onClick={() => { onOpen(item.id); onClose(); }}>
            <ExternalLink className="h-3.5 w-3.5" />
          </button>
          <button type="button" className={btnGhost} aria-label="Close quick reference" onClick={onClose}>
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
      <div className="flex flex-col gap-3 overflow-y-auto p-3 text-xs">
        {itemType(item) === 'image' && <Picture item={item} assets={assets} />}
        {item.synopsis?.trim() && <p className="rounded border border-line bg-accent-soft p-2 italic">{item.synopsis}</p>}
        {content === undefined ? <p className="text-content-muted">Loading…</p> : <MarkdownView text={content} onOpenLink={onOpenLink} empty="No text." />}
        {item.citations?.length ? (
          <div className="border-t border-line pt-2">
            <h3 className="mb-1 text-[11px] font-semibold uppercase text-content-muted">Sources</h3>
            <ul className="list-disc pl-4">
              {item.citations.map(c => <li key={c.id}>{c.source}{c.quote ? ` — “${c.quote}”` : ''}</li>)}
            </ul>
          </div>
        ) : null}
      </div>
    </section>
  );
}
