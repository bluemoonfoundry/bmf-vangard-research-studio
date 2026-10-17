import { useMemo } from 'react';
import { AlertTriangle, X } from 'lucide-react';
import type { Bible, StoryPosition, TreeItem } from '@/project/types';
import { entityKindOf, isEvent } from '@/bible/entities';
import { eventsLinkingTo } from '@/bible/links';
import { formatPosition } from '@/bible/normalize';
import { addDependency, removeDependency } from '@/bible/ops';
import { checkPosition, eventsInCycles, keptPositions, type Check } from '@/bible/ordering';
import { buildTimeline } from '@/bible/timeline';
import { fieldLabel, input } from '@/components/workspace/ui';

interface Common {
  items: TreeItem[];
  bible: Bible;
  updateBible(update: (b: Bible) => Bible): void;
  onOpenEntity?(id: string): void;
}

const SYMBOL: Record<Check, { mark: string; label: string; cls: string }> = {
  ok: { mark: '✓', label: 'ok', cls: 'text-accent' },
  violated: { mark: '✗', label: 'violated', cls: 'text-warning' },
  unknown: { mark: '?', label: 'unknown', cls: 'text-content-muted' },
};

function Mark({ result }: { result: Check }) {
  const s = SYMBOL[result];
  return <span role="img" aria-label={s.label} className={`w-4 text-center font-semibold ${s.cls}`}>{s.mark}</span>;
}

function NameButton({ item, onOpenEntity }: { item: TreeItem; onOpenEntity?(id: string): void }) {
  return (
    <button type="button" className="text-left text-xs text-accent hover:underline" onClick={() => onOpenEntity?.(item.id)}>
      {item.title}
    </button>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section aria-label={label} className="flex flex-col gap-1.5">
      <h3 className={fieldLabel}>{label}</h3>
      {children}
    </section>
  );
}

export function EventDetails({ event, items, bible, updateBible, onOpenEntity }: Common & { event: TreeItem }) {
  const byId = useMemo(() => new Map(items.map(i => [i.id, i])), [items]);
  const positions = useMemo(() => keptPositions(bible, event.id), [bible, event.id]);
  const inCycle = useMemo(() => eventsInCycles(bible).has(event.id), [bible, event.id]);
  const deps = bible.dependencies.filter(d => d.eventId === event.id);
  const taken = new Set([event.id, ...deps.map(d => d.afterEventId)]);
  const candidates = items.filter(i => isEvent(i) && !taken.has(i.id));

  const resultFor = (depId: string, p: StoryPosition): Check =>
    checkPosition(bible, event.id, p).find(c => c.dependencyId === depId)?.result ?? 'unknown';

  const linked = (event.references ?? []).map(r => byId.get(r.targetId)).filter((t): t is TreeItem => t !== undefined);
  const plotlines = linked.filter(t => entityKindOf(t) === 'plotline');
  const participants = linked.filter(t => t.type === 'entity' && entityKindOf(t) !== 'plotline');

  const list = (label: string, group: TreeItem[]) => group.length > 0 && (
    <Section label={label}>
      <ul className="flex flex-col gap-1">{group.map(t => <li key={t.id}><NameButton item={t} onOpenEntity={onOpenEntity} /></li>)}</ul>
    </Section>
  );

  return (
    <>
      <Section label="When">
        <p className="text-xs">{positions.length > 0 ? positions.map(formatPosition).join(' / ') : 'Not placed yet'}</p>
      </Section>

      <Section label="Must come after">
        {inCycle && (
          <p className="flex items-center gap-1.5 text-xs text-warning">
            <AlertTriangle className="h-3.5 w-3.5" aria-hidden /> Circular dependency: these events wait on each other.
          </p>
        )}
        <ul className="flex flex-col gap-1.5">
          {deps.map(d => {
            const other = byId.get(d.afterEventId);
            const name = other?.title ?? 'Missing event';
            return (
              <li key={d.id} className="flex flex-col gap-0.5">
                <div className="flex items-center gap-2 text-xs">
                  {other ? <NameButton item={other} onOpenEntity={onOpenEntity} /> : <span>{name}</span>}
                  <button
                    type="button" aria-label={`Remove dependency on ${name}`} className="text-content-muted hover:text-content"
                    onClick={() => updateBible(b => removeDependency(b, d.id))}
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
                {positions.length === 0 && (
                  <div className="flex items-center gap-1.5 pl-1 text-[11px] text-content-muted">
                    <Mark result="unknown" /> no kept position to check
                  </div>
                )}
                {positions.map(p => (
                  <div key={formatPosition(p)} className="flex items-center gap-1.5 pl-1 text-[11px] text-content-muted">
                    <Mark result={resultFor(d.id, p)} />
                    {positions.length > 1 && <span>{formatPosition(p)}</span>}
                  </div>
                ))}
              </li>
            );
          })}
        </ul>
        {candidates.length > 0 && (
          <select
            aria-label="Add dependency" className={input} value=""
            onChange={(e) => {
              const afterEventId = e.target.value;
              if (afterEventId) updateBible(b => addDependency(b, { id: crypto.randomUUID(), eventId: event.id, afterEventId }));
            }}
          >
            <option value="">Add an event this must come after...</option>
            {candidates.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}
          </select>
        )}
      </Section>

      {list('Participants', participants)}
      {list('Plotline', plotlines)}
    </>
  );
}

export function EntityEvents({ entity, items, bible, onOpenEntity }: Omit<Common, 'updateBible'> & { entity: TreeItem }) {
  const events = useMemo(() => {
    const linkedEvents = eventsLinkingTo(items, entity.id);
    if (entityKindOf(entity) !== 'plotline') return linkedEvents;
    const rank = new Map<string, number>();
    buildTimeline(bible, items).placed.forEach((p, i) => { if (!rank.has(p.eventId)) rank.set(p.eventId, i); });
    const at = (id: string) => rank.get(id) ?? Number.MAX_SAFE_INTEGER;
    return [...linkedEvents].sort((a, b) => at(a.id) - at(b.id));
  }, [entity, items, bible]);

  if (events.length === 0) return null;
  return (
    <Section label="Events">
      <ul className="flex flex-col gap-1">{events.map(ev => <li key={ev.id}><NameButton item={ev} onOpenEntity={onOpenEntity} /></li>)}</ul>
    </Section>
  );
}
