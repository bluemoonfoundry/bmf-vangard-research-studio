import { useState } from 'react';
import { BookOpen, Columns2, Plus, Trash2 } from 'lucide-react';
import type { TreeItem } from '@/project/types';
import type { DocEntry } from '@/project/projectState';
import type { AssetCache } from '@/workspace/assetCache';
import { NO_LABEL_COLOR, itemType, labelOf, statusName } from '@/workspace/research';
import { wordCount } from '@/workspace/stats';
import type { DropPosition } from '@/workspace/treeOps';
import { useAssetUrl } from '@/workspace/useAssetUrl';
import { ItemIcon } from '@/components/workspace/ItemIcon';
import { btnPrimary, segment, segmentGroup } from '@/components/workspace/ui';

const DRAG_TYPE = 'application/x-vrs-card';

type Board = 'cork' | 'grid' | 'plain';
type CardSize = 'sm' | 'md' | 'lg';

const BOARD_CLASS: Record<Board, string> = { cork: 'corkboard-cork', grid: 'corkboard-grid', plain: 'corkboard-plain' };
const CARD_CLASS: Record<CardSize, string> = { sm: 'w-56 min-h-[200px]', md: 'w-72 min-h-[240px]', lg: 'w-96 min-h-[300px]' };

export interface ContainerViewProps {
  /** The folder whose children are shown, or null for the top level. */
  folder: TreeItem | null;
  folderTitle: string;
  children: TreeItem[];
  docs: Record<string, DocEntry>;
  selectedId: string | null;
  onSelect(id: string): void;
  onOpen(id: string): void;
  onOpenInSplit(id: string): void;
  onUpdate(id: string, patch: Partial<TreeItem>): void;
  onCreate(): void;
  onDelete(id: string): void;
  onMove(id: string, targetId: string | null, position: DropPosition): void;
}

function CardThumbnail({ item, assets }: { item: TreeItem; assets: AssetCache | null }) {
  const state = useAssetUrl(assets, item.asset);
  if (state.status !== 'ready') return null;
  return (
    <div className="h-28 overflow-hidden border-b border-card-line bg-surface-sunken">
      <img src={state.url} alt={item.mediaAlt || item.title} className="h-full w-full object-cover" />
    </div>
  );
}

/** Index cards for a folder's children, reorderable by drag. */
export function CorkboardView(props: ContainerViewProps & { assets: AssetCache | null }) {
  const { folderTitle, children, docs, selectedId, onSelect, onOpen, onOpenInSplit, onUpdate, onCreate, onDelete, onMove, assets } = props;
  const [board, setBoard] = useState<Board>('cork');
  const [size, setSize] = useState<CardSize>('md');
  const [dragged, setDragged] = useState<string | null>(null);
  const [drop, setDrop] = useState<{ id: string; position: 'before' | 'after' } | null>(null);

  const endDrag = () => {
    setDragged(null);
    setDrop(null);
  };

  return (
    <div className={`flex min-h-0 flex-1 flex-col overflow-hidden ${BOARD_CLASS[board]}`}>
      <div className="flex min-h-11 shrink-0 flex-wrap items-center justify-between gap-x-3 gap-y-1.5 border-b border-line bg-surface-raised px-4 py-1.5 text-xs">
        <div className="flex min-w-0 items-center gap-2">
          <h2 className="truncate font-serif text-sm font-semibold">{folderTitle}</h2>
          <span className="whitespace-nowrap text-content-muted">{children.length} {children.length === 1 ? 'card' : 'cards'}</span>
        </div>
        <div className="flex items-center gap-2 whitespace-nowrap">
          <div className={segmentGroup} role="group" aria-label="Card size">
            {(['sm', 'md', 'lg'] as const).map(s => (
              <button key={s} type="button" className={segment(size === s)} aria-pressed={size === s} onClick={() => setSize(s)}>
                {{ sm: 'S', md: 'M', lg: 'L' }[s]}
              </button>
            ))}
          </div>
          <div className={segmentGroup} role="group" aria-label="Board background">
            {(['cork', 'grid', 'plain'] as const).map(b => (
              <button key={b} type="button" className={segment(board === b)} aria-pressed={board === b} onClick={() => setBoard(b)}>
                {{ cork: 'Cork', grid: 'Grid', plain: 'Plain' }[b]}
              </button>
            ))}
          </div>
          <button type="button" className={btnPrimary} onClick={onCreate}>
            <Plus className="h-3.5 w-3.5" /> New card
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        {children.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
            <h3 className="font-serif text-lg font-bold">No cards here yet</h3>
            <p className="max-w-sm text-xs text-content-muted">Each item in this folder appears as an index card. Add notes, character sheets, images or clippings.</p>
            <button type="button" className={btnPrimary} onClick={onCreate}><Plus className="h-3.5 w-3.5" /> New card</button>
          </div>
        ) : (
          <ul aria-label="Index cards" className="flex flex-wrap items-start gap-5">
            {children.map((item) => {
              const label = labelOf(item);
              const status = statusName(item);
              const doc = docs[item.id];
              const selected = item.id === selectedId;
              const title = item.title || 'Untitled';
              return (
                <li
                  key={item.id}
                  aria-label={title}
                  aria-current={selected ? 'true' : undefined}
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData(DRAG_TYPE, item.id);
                    e.dataTransfer.effectAllowed = 'move';
                    setDragged(item.id);
                  }}
                  onDragEnd={endDrag}
                  onDragOver={(e) => {
                    if (!dragged || dragged === item.id) return;
                    e.preventDefault();
                    const rect = e.currentTarget.getBoundingClientRect();
                    const position = e.clientX - rect.left < rect.width / 2 ? 'before' : 'after';
                    if (drop?.id !== item.id || drop.position !== position) setDrop({ id: item.id, position });
                  }}
                  onDragLeave={(e) => {
                    if (!e.currentTarget.contains(e.relatedTarget as Node | null) && drop?.id === item.id) setDrop(null);
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    const id = e.dataTransfer.getData(DRAG_TYPE) || dragged;
                    if (id && drop?.id === item.id) onMove(id, item.id, drop.position);
                    endDrag();
                  }}
                  onClick={() => onSelect(item.id)}
                  onDoubleClick={() => onOpen(item.id)}
                  className={`group relative flex cursor-grab flex-col overflow-hidden rounded-md border bg-card text-card-content shadow-md hover:shadow-lg ${CARD_CLASS[size]} ${
                    selected ? 'border-accent ring-2 ring-accent' : 'border-card-line'
                  } ${dragged === item.id ? 'opacity-40' : ''}`}
                >
                  {drop?.id === item.id && (
                    <div className={`pointer-events-none absolute inset-y-0 z-10 w-1.5 bg-accent ${drop.position === 'before' ? 'left-0' : 'right-0'}`} />
                  )}
                  <div className="h-2.5 shrink-0" style={{ backgroundColor: label?.color ?? NO_LABEL_COLOR }} />
                  <div className="flex items-center gap-1.5 border-b border-card-line bg-card-header px-2.5 py-1.5">
                    <ItemIcon item={item} className="h-3.5 w-3.5 text-card-muted" />
                    <input
                      aria-label={`Title of ${title}`}
                      className="min-w-0 flex-1 rounded border border-transparent bg-transparent px-1 py-0.5 font-serif text-xs font-bold focus:border-accent focus:outline-none"
                      value={item.title}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => onUpdate(item.id, { title: e.target.value })}
                    />
                    <span className="flex shrink-0 items-center opacity-0 group-focus-within:opacity-100 group-hover:opacity-100">
                      <CardAction label={`Open ${title} in split view`} onClick={() => onOpenInSplit(item.id)}><Columns2 className="h-3 w-3" /></CardAction>
                      <CardAction label={`Open ${title}`} onClick={() => onOpen(item.id)}><BookOpen className="h-3 w-3" /></CardAction>
                      <CardAction label={`Delete ${title}`} onClick={() => onDelete(item.id)}><Trash2 className="h-3 w-3" /></CardAction>
                    </span>
                  </div>
                  {itemType(item) === 'image' && <CardThumbnail item={item} assets={assets} />}
                  <div className="flex flex-1 flex-col justify-between p-2.5">
                    <textarea
                      aria-label={`Synopsis of ${title}`}
                      className="h-24 w-full resize-none rounded bg-transparent p-1 text-xs leading-relaxed placeholder:text-card-muted focus:bg-card-header focus:outline-none"
                      value={item.synopsis ?? ''}
                      placeholder="Synopsis…"
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => onUpdate(item.id, { synopsis: e.target.value })}
                    />
                    <div className="mt-2 flex items-center justify-between border-t border-card-line pt-1.5 text-[10px] text-card-muted">
                      <span className="flex items-center gap-1">
                        {label && <span className="font-semibold" style={{ color: label.color }}>{label.short}</span>}
                        {label && status && <span aria-hidden>·</span>}
                        {status && <span>{status}</span>}
                      </span>
                      <span className="font-mono tabular-nums">{doc ? `${wordCount(doc.current)} words` : ''}</span>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

function CardAction({ label, onClick, children }: { label: string; onClick(): void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className="rounded p-1 text-card-muted hover:bg-card hover:text-card-content"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
    >
      {children}
    </button>
  );
}
