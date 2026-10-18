import { useEffect, useMemo, useState } from 'react';
import type { Bible, FactSource, TreeItem } from '@/project/types';
import type { ChatOf } from '@/chat/types';
import { isEvent } from '@/bible/entities';
import { isWhenAttribute } from '@/bible/normalize';
import { findContradictions, groupVersions, openContradictions } from '@/bible/contradictions';
import { keepAll, keepOne, reopen } from '@/bible/ops';
import { newerVersion } from '@/bible/newer';
import { VersionCard } from '@/components/bible/VersionCard';
import { btn, btnPrimary, fieldLabel, input, segment, segmentGroup } from '@/components/workspace/ui';

export interface ConflictQueueProps {
  bible: Bible;
  items: TreeItem[];
  contentOf(id: string): string | undefined;
  /** AI chat transcripts, for sources citing a message. */
  chatOf: ChatOf;
  /** Contradiction to show first (from "Show in conflict queue"). */
  focusKey?: string;
  onUpdate(update: (b: Bible) => Bible): void;
  onOpenSource(source: FactSource): void;
  onOpenEntity(id: string): void;
  /** Source item ids, oldest first, for the "Keep the newer" suggestion. */
  sourceOrder?: readonly string[];
}

type Filter = 'open' | 'decided';

export function ConflictQueue({ bible, items, contentOf, chatOf, focusKey, onUpdate, onOpenSource, onOpenEntity, sourceOrder = [] }: ConflictQueueProps) {
  const [filter, setFilter] = useState<Filter>('open');
  const [selectedKey, setSelectedKey] = useState<string | null>(focusKey ?? null);
  const [note, setNote] = useState('');

  useEffect(() => {
    if (focusKey) {
      setSelectedKey(focusKey);
      setFilter('open');
    }
  }, [focusKey]);

  const byId = useMemo(() => new Map(items.map(i => [i.id, i])), [items]);
  const open = useMemo(() => {
    const ids = new Set(items.filter(i => i.type === 'entity').map(i => i.id));
    return openContradictions(findContradictions(bible, ids));
  }, [bible, items]);
  const decisions = useMemo(() => [...bible.decisions].reverse(), [bible.decisions]);

  const current = open.find(c => c.key === selectedKey) ?? open[0];
  const titleOf = (id: string) => byId.get(id)?.title || 'Untitled';

  const select = (key: string) => { setSelectedKey(key); setNote(''); };

  /** Applies a decision, then moves on to the next open contradiction. */
  const decide = (apply: (b: Bible, id: string, now: string, note?: string) => Bible) => {
    if (!current) return;
    const idx = open.indexOf(current);
    const next = open[idx + 1] ?? open[idx - 1];
    const trimmed = note.trim();
    onUpdate(b => apply(b, crypto.randomUUID(), new Date().toISOString(), trimmed || undefined));
    setSelectedKey(next?.key ?? null);
    setNote('');
  };

  const entity = current ? byId.get(current.entityId) : undefined;
  const checkEventId = current && entity && isEvent(entity) && isWhenAttribute(current.attribute) ? current.entityId : undefined;
  const keepAllLabel = current && current.versions.length >= 3 ? 'Keep all' : 'Keep both';
  const newer = current ? newerVersion(current, sourceOrder) : null;

  // Versions, not facts: corroborating sources add facts without adding versions.
  const kindLabel = (d: Bible['decisions'][number]) => {
    if (d.kind === 'kept_one') return 'Kept one';
    const ids = new Set(d.factIds);
    const facts = bible.facts.filter(f => ids.has(f.id));
    const versions = facts.length ? groupVersions(facts).length : d.factIds.length;
    return versions > 2 ? 'Kept all' : 'Kept both';
  };

  return (
    <div className="flex min-h-0 flex-1">
      <aside aria-label="Contradictions" className="flex w-72 shrink-0 flex-col gap-2 overflow-y-auto border-r border-line p-3">
        <div className={segmentGroup} role="group" aria-label="Filter">
          <button type="button" className={segment(filter === 'open')} aria-pressed={filter === 'open'} onClick={() => setFilter('open')}>Open</button>
          <button type="button" className={segment(filter === 'decided')} aria-pressed={filter === 'decided'} onClick={() => setFilter('decided')}>Decided</button>
        </div>
        {filter === 'open' ? (
          <ul className="flex flex-col gap-1">
            {open.map(c => (
              <li key={c.key}>
                <button
                  type="button"
                  aria-current={c === current}
                  className={`flex w-full flex-col rounded px-2 py-1.5 text-left text-xs hover:bg-surface-sunken ${c === current ? 'bg-surface-sunken' : ''}`}
                  onClick={() => select(c.key)}
                >
                  <span>{titleOf(c.entityId)} · {c.attribute}</span>
                  <span className="text-[11px] text-content-muted">{c.versions.length} versions</span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <ul className="flex flex-col gap-2">
            {decisions.length === 0 && <li className="text-xs text-content-muted">No decisions yet</li>}
            {decisions.map(d => (
              <li key={d.id} className="flex flex-col gap-1 rounded border border-line p-2 text-xs">
                <span>{titleOf(d.entityId)} · {d.attribute}</span>
                <span className="text-[11px] text-content-muted">
                  <span>{kindLabel(d)}</span> · {new Date(d.at).toLocaleDateString()}
                </span>
                {d.note && <span className="text-[11px] text-content-muted">{d.note}</span>}
                <button type="button" className={`${btn} self-start`} onClick={() => onUpdate(b => reopen(b, d.id, new Date().toISOString()))}>Reopen</button>
              </li>
            ))}
          </ul>
        )}
      </aside>

      <section aria-label="Versions" className="flex min-w-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
        {filter === 'decided' ? (
          <p className="text-xs text-content-muted">Reopen a decision to see its versions again.</p>
        ) : !current ? (
          <p className="text-sm text-content-muted">No open contradictions</p>
        ) : (
          <>
            <div className="flex items-baseline gap-2">
              <h2 className="text-sm font-semibold">{titleOf(current.entityId)} · {current.attribute}</h2>
              <button type="button" className="text-xs text-accent hover:underline" onClick={() => onOpenEntity(current.entityId)}>Open page</button>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              {current.versions.map((v, i) => (
                <VersionCard
                  key={`${current.key}:${i}`}
                  version={v}
                  checkEventId={checkEventId}
                  bible={bible}
                  byId={byId}
                  contentOf={contentOf}
                  chatOf={chatOf}
                  onKeep={() => decide((b, id, now, n) => keepOne(b, current, i, { id, now, note: n }))}
                  onOpenSource={onOpenSource}
                />
              ))}
            </div>
            <label className="flex flex-col gap-1">
              <span className={fieldLabel}>Note</span>
              <input className={input} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional" />
            </label>
            <div className="flex flex-wrap gap-2">
              {newer !== null && (
                <button
                  type="button"
                  className={btnPrimary}
                  title="Keeps the version from the source furthest down the source order"
                  onClick={() => decide((b, id, now, n) => keepOne(b, current, newer, { id, now, note: n }))}
                >
                  Keep the newer
                </button>
              )}
              <button type="button" className={btn} onClick={() => decide((b, id, now, n) => keepAll(b, current, { id, now, note: n }))}>
                {keepAllLabel}
              </button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
