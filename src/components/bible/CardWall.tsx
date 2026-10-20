import { useMemo } from 'react';
import { AlertTriangle, Plus, ScanSearch } from 'lucide-react';
import type { Bible, TreeItem } from '@/project/types';
import type { AssetCache } from '@/workspace/assetCache';
import { findContradictions, openContradictions } from '@/bible/contradictions';
import { ENTITY_KINDS } from '@/bible/entities';
import { cardLines, cardStats, portraitOf, wallTabs, type CardStats, type WallTabId } from '@/bible/cards';
import { valueText } from '@/components/bible/FactRow';
import { Portrait } from '@/components/bible/Portrait';
import { sharedNames, sharedNamesText } from '@/bible/names';
import { btn, btnPrimary, segment, segmentGroup } from '@/components/workspace/ui';

export interface CardWallProps {
  items: TreeItem[];
  bible: Bible;
  assets: AssetCache | null;
  tab: WallTabId;
  onTab(tab: WallTabId): void;
  onOpenCard(id: string): void;
  /** Creates an entity of a known kind and opens its card. */
  onNewEntity(kind: Exclude<WallTabId, 'other'>): void;
  /** AI on: offers a semantic conflict check of the shown kind, and badges flagged cards. */
  aiEnabled?: boolean;
  /** Live conflict check flags per entity id. */
  flagCounts?: ReadonlyMap<string, number>;
  onCheckConflicts?(entityIds: string[], label: string): void;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The open-conflict, flagged and to-review badges shared by cards and the full card view. */
export function CardBadges({ stats, flagged = 0 }: { stats: CardStats; flagged?: number }) {
  return (
    <span className="flex flex-wrap gap-1 text-[11px]">
      {stats.openConflicts > 0 && (
        <span className="inline-flex items-center gap-1 rounded-full border border-warning px-1.5">
          <AlertTriangle className="h-3 w-3" aria-hidden />{plural(stats.openConflicts, 'conflict')}
        </span>
      )}
      {flagged > 0 && (
        <span className="rounded-full border border-dashed border-warning px-1.5" title="Possible conflicts found by the AI check">{flagged} flagged</span>
      )}
      {stats.proposed > 0
        ? <span className="rounded-full border border-accent px-1.5 text-accent">{stats.proposed} to review</span>
        : stats.kept > 0 && <span className="rounded-full border border-line px-1.5 text-content-muted">all reviewed</span>}
    </span>
  );
}

/** Entities of one kind as a wall of cards showing their kept facts at a glance. */
export function CardWall({ items, bible, assets, tab, onTab, onOpenCard, onNewEntity, aiEnabled = false, flagCounts, onCheckConflicts }: CardWallProps) {
  const tabs = useMemo(() => wallTabs(items), [items]);
  const byId = useMemo(() => new Map(items.map(i => [i.id, i])), [items]);
  const open = useMemo(() => {
    const ids = new Set(items.filter(i => i.type === 'entity').map(i => i.id));
    return openContradictions(findContradictions(bible, ids));
  }, [bible, items]);
  const current = tabs.find(t => t.id === tab) ?? tabs[0];
  const kindName = ENTITY_KINDS.find(k => k.id === current.id)?.name;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-11 shrink-0 flex-wrap items-center justify-between gap-2 border-b border-line bg-surface-raised px-4 py-1.5 text-xs">
        <div className={`${segmentGroup} flex-wrap`} role="group" aria-label="Kind">
          {tabs.map(t => (
            <button key={t.id} type="button" className={segment(t === current)} aria-pressed={t === current} onClick={() => onTab(t.id)}>
              {t.name} <span className="tabular-nums opacity-80">{t.entities.length}</span>
            </button>
          ))}
        </div>
        <span className="flex gap-2">
          {aiEnabled && onCheckConflicts && current.entities.length > 0 && (
            <button
              type="button"
              className={btn}
              title={`Ask the AI for ${current.name.toLowerCase()} facts that can't all be true`}
              onClick={() => onCheckConflicts(current.entities.map(e => e.id), current.name)}
            >
              <ScanSearch className="h-3.5 w-3.5" /> Check for conflicts
            </button>
          )}
          {current.id !== 'other' && kindName && (
            <button type="button" className={btnPrimary} onClick={() => onNewEntity(current.id as Exclude<WallTabId, 'other'>)}>
              <Plus className="h-3.5 w-3.5" /> New {kindName.toLowerCase()}
            </button>
          )}
        </span>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        {current.entities.length === 0 ? (
          <p className="text-sm text-content-muted">No {current.name.toLowerCase()} yet.</p>
        ) : (
          <ul aria-label="Cards" className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(15rem,1fr))]">
            {current.entities.map(e => {
              const lines = cardLines(bible, e);
              const stats = cardStats(bible, e.id, open);
              const title = e.title || 'Untitled';
              return (
                <li key={e.id}>
                  <button
                    type="button"
                    className="flex h-full w-full flex-col gap-2 rounded-lg border border-line bg-surface-raised p-3 text-left text-xs hover:border-accent"
                    onClick={() => onOpenCard(e.id)}
                  >
                    <span className="flex items-start gap-2.5">
                      <Portrait entity={e} image={portraitOf(e, byId)} assets={assets} size="sm" />
                      <span className="flex min-w-0 flex-col gap-0.5">
                        <span className="truncate font-serif text-sm font-semibold">{title}</span>
                        {e.synopsis && <span className="line-clamp-2 text-content-muted">{e.synopsis}</span>}
                        {current.id === 'character' && sharedNamesText(sharedNames(e.title, items, e.id)).map(t => (
                          <span key={t} className="truncate text-content-muted">{t}</span>
                        ))}
                      </span>
                    </span>
                    {lines.length > 0 && (
                      <dl className="flex flex-col gap-0.5">
                        {lines.map(l => (
                          <div key={l.key} className="flex gap-1.5">
                            <dt className="shrink-0 font-semibold">{l.attribute}:</dt>
                            <dd className="truncate">{l.versions.map(v => valueText(v.value)).join(' / ')}</dd>
                          </div>
                        ))}
                      </dl>
                    )}
                    <CardBadges stats={stats} flagged={aiEnabled ? flagCounts?.get(e.id) : 0} />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
