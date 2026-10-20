import { useEffect, useMemo, useRef, useState } from 'react';
import type { Bible, TreeItem } from '@/project/types';
import { buildTimeline, type TimelineEntry } from '@/bible/timeline';
import { contradictionKey } from '@/bible/contradictions';
import { formatPosition, WHEN } from '@/bible/normalize';

export interface TimelineViewProps {
  bible: Bible;
  items: TreeItem[];
  onOpenEntity(id: string): void;
  onShowConflict(key: string): void;
}

const rowClass = 'flex w-full items-center gap-2 rounded px-2 py-1 text-left text-xs text-content hover:bg-surface-sunken';
const badge = 'rounded border border-line px-1 text-[10px]';
const entryKey = (e: TimelineEntry) => `${e.eventId}-${e.versionIndex}`;

export function TimelineView({ bible, items, onOpenEntity, onShowConflict }: TimelineViewProps) {
  const timeline = useMemo(() => buildTimeline(bible, items), [bible, items]);
  const titles = useMemo(() => new Map(items.map(i => [i.id, i.title])), [items]);
  const title = (id: string) => titles.get(id) ?? id;
  const rowRefs = useRef(new Map<string, HTMLButtonElement>());
  const [flash, setFlash] = useState<string | null>(null);

  useEffect(() => {
    if (flash === null) return;
    const t = setTimeout(() => setFlash(null), 1500);
    return () => clearTimeout(t);
  }, [flash]);

  const jumpTo = (key: string) => {
    const el = rowRefs.current.get(key);
    if (!el) return;
    el.scrollIntoView?.({ block: 'center' });
    el.focus();
    setFlash(key);
  };

  const seasons = useMemo(() => {
    const groups: { season: number; entries: TimelineEntry[] }[] = [];
    for (const entry of timeline.placed) {
      const last = groups[groups.length - 1];
      if (last && last.season === entry.position.season) last.entries.push(entry);
      else groups.push({ season: entry.position.season, entries: [entry] });
    }
    return groups;
  }, [timeline]);

  if (timeline.contested.length + timeline.placed.length + timeline.unplaced.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center p-6 text-xs text-content-muted">
        No events yet. Add an Entity of kind Event to build the timeline.
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
      {timeline.contested.length > 0 && (
        <section aria-labelledby="tl-contested">
          <h3 id="tl-contested" className="mb-1 text-xs font-semibold text-content">Timing contested</h3>
          <ul>
            {timeline.contested.map(id => (
              <li key={id}>
                <button type="button" className={rowClass} onClick={() => onShowConflict(contradictionKey(id, WHEN))}>
                  <span aria-hidden="true">⚠</span>
                  <span>{title(id)}</span>
                  <span className="text-content-muted">Show in conflict queue</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
      {seasons.map(group => (
        <section key={group.season} aria-labelledby={`tl-season-${group.season}`}>
          <h3 id={`tl-season-${group.season}`} className="mb-1 text-xs font-semibold text-content">{`Season ${group.season}`}</h3>
          <ul>
            {group.entries.map(e => (
              <li key={entryKey(e)} className="flex items-center gap-1">
                <button
                  type="button"
                  ref={el => { if (el) rowRefs.current.set(entryKey(e), el); else rowRefs.current.delete(entryKey(e)); }}
                  className={`${rowClass} ${flash === entryKey(e) ? 'ring-2 ring-accent' : ''}`}
                  onClick={() => onOpenEntity(e.eventId)}
                >
                  <span className="w-24 shrink-0 text-content-muted">{formatPosition(e.position)}</span>
                  <span>{title(e.eventId)}</span>
                  {e.versionCount > 1 && (
                    <span className="text-content-muted">{`version ${e.versionIndex + 1} of ${e.versionCount}`}</span>
                  )}
                  {e.violated && <span className={`${badge} text-danger`}><span aria-hidden="true">✗ </span>Out of order</span>}
                  {e.inCycle && <span className={`${badge} text-warning`}>Cycle</span>}
                </button>
                {e.versionCount > 1 && (
                  <span className="flex shrink-0 gap-1">
                    {Array.from({ length: e.versionCount }, (_, i) => i).filter(i => i !== e.versionIndex).map(i => (
                      <button
                        key={i}
                        type="button"
                        className={`${badge} text-content-muted hover:bg-surface-sunken hover:text-content`}
                        aria-label={`Go to version ${i + 1} of ${e.versionCount} of ${title(e.eventId)}`}
                        title={`Go to version ${i + 1}`}
                        onClick={() => jumpTo(`${e.eventId}-${i}`)}
                      >
                        {`→ ${i + 1}`}
                      </button>
                    ))}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </section>
      ))}
      {timeline.unplaced.length > 0 && (
        <section aria-labelledby="tl-unplaced">
          <h3 id="tl-unplaced" className="mb-1 text-xs font-semibold text-content">Unplaced</h3>
          <ul>
            {timeline.unplaced.map(id => (
              <li key={id}>
                <button type="button" className={rowClass} onClick={() => onOpenEntity(id)}>{title(id)}</button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
