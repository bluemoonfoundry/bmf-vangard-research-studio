import { useMemo, useState } from 'react';
import { AlertTriangle, ChevronDown, ChevronRight, Contact, Plus } from 'lucide-react';
import type { Bible, EntityKind, Fact, FactSource, TreeItem } from '@/project/types';
import type { ChatOf } from '@/chat/types';
import { attributeSuggestions, isEvent } from '@/bible/entities';
import { attributeKey } from '@/bible/normalize';
import { findContradictions, openContradictions, contradictionKey } from '@/bible/contradictions';
import { ageAtStart } from '@/bible/ages';
import { addFact, setFactStatus, updateFact } from '@/bible/ops';
import { resolveSource, sourceText } from '@/bible/sources';
import { EntityEvents, EventDetails } from '@/components/bible/EventLinks';
import { FactForm } from '@/components/bible/FactForm';
import { FactRow, type FactRowSection } from '@/components/bible/FactRow';
import { btn, fieldLabel } from '@/components/workspace/ui';

export interface EntityPanelProps {
  entity: TreeItem;
  /** Every binder item: entities scope the contradiction check, and sources are looked up here. */
  items: TreeItem[];
  bible: Bible;
  /** The body of an item, or undefined while it loads. */
  bodyOf(id: string): string | undefined;
  /** An AI chat's transcript, or undefined while it loads (for sources citing a message). */
  chatOf: ChatOf;
  updateBible(update: (b: Bible) => Bible): void;
  onShowConflict?(key: string): void;
  onOpenSource(source: FactSource): void;
  /** Opens another entity (an event's participant or plotline, a dependency, a backlink). */
  onOpenEntity?(id: string): void;
  /** Opens this entity's full card in the card wall. */
  onOpenCard?(id: string): void;
}

const now = () => new Date().toISOString();

export function EntityPanel({ entity, items, bible, bodyOf, chatOf, updateBible, onShowConflict, onOpenSource, onOpenEntity, onOpenCard }: EntityPanelProps) {
  const [adding, setAdding] = useState(false);
  const [showAside, setShowAside] = useState(false);

  const byId = useMemo(() => new Map(items.map(i => [i.id, i])), [items]);
  const contradictions = useMemo(() => {
    const ids = new Set(items.filter(i => i.type === 'entity').map(i => i.id));
    return findContradictions(bible, ids).filter(c => c.entityId === entity.id);
  }, [bible, items, entity.id]);
  const open = openContradictions(contradictions);
  const startAgeLine = ageAtStart(bible, entity.id);

  const facts = bible.facts.filter(f => f.entityId === entity.id);
  const kept = facts.filter(f => f.status === 'kept');
  const pending = facts.filter(f => f.status === 'proposed');
  const aside = facts.filter(f => f.status === 'set_aside');

  const keptGroups = useMemo(() => {
    const groups = new Map<string, Fact[]>();
    for (const f of kept) {
      const key = attributeKey(f.attribute);
      groups.set(key, [...(groups.get(key) ?? []), f]);
    }
    return [...groups.entries()];
  }, [kept]);

  const suggestions = (kind: EntityKind | null) => attributeSuggestions(bible, items, kind);

  const row = (f: Fact, section: FactRowSection, showAttribute: boolean) => {
    const src = f.source;
    return (
      <FactRow
        key={f.id}
        fact={f}
        section={section}
        showAttribute={showAttribute}
        entity={entity}
        attributeSuggestions={suggestions}
        sourceState={src ? resolveSource(src, sourceText(src, bodyOf, chatOf), byId.has(src.itemId)) : null}
        sourceTitle={src ? byId.get(src.itemId)?.title : undefined}
        onKeep={() => updateBible(b => setFactStatus(b, f.id, 'kept', now()))}
        onSetAside={() => updateBible(b => setFactStatus(b, f.id, 'set_aside', now()))}
        onRestore={() => updateBible(b => setFactStatus(b, f.id, 'kept', now()))}
        onUnreview={() => updateBible(b => setFactStatus(b, f.id, 'proposed', now()))}
        onEdit={(attribute, value) => updateBible(b => updateFact(b, f.id, { attribute, value }, now()))}
        onOpenSource={onOpenSource}
      />
    );
  };

  const section = (label: string, list: Fact[], body: React.ReactNode) => list.length > 0 && (
    <section aria-label={label} className="flex flex-col gap-1.5">
      <h3 className={fieldLabel}>{label}</h3>
      {body}
    </section>
  );

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-line p-3" data-testid="entity-panel">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">Facts</h2>
        <div className="flex gap-1.5">
          {onOpenCard && (
            <button type="button" className={btn} onClick={() => onOpenCard(entity.id)}>
              <Contact className="h-3.5 w-3.5" /> Open card
            </button>
          )}
          {!adding && (
            <button type="button" className={btn} onClick={() => setAdding(true)}>
              <Plus className="h-3.5 w-3.5" /> Add fact
            </button>
          )}
        </div>
      </div>
      {startAgeLine && <p className="text-xs text-content-muted">Age: {startAgeLine}</p>}

      {adding && (
        <FactForm
          entities={[entity]}
          fixedEntityId={entity.id}
          attributeSuggestions={suggestions}
          onSubmit={(f) => {
            const t = now();
            const fact: Fact = {
              id: crypto.randomUUID(), entityId: entity.id, attribute: f.attribute, value: f.value,
              status: 'kept', origin: 'manual', createdAt: t, updatedAt: t,
            };
            updateBible(b => addFact(b, fact));
            setAdding(false);
          }}
          onCancel={() => setAdding(false)}
        />
      )}

      {isEvent(entity)
        ? <EventDetails event={entity} items={items} bible={bible} updateBible={updateBible} onOpenEntity={onOpenEntity} />
        : <EntityEvents entity={entity} items={items} bible={bible} onOpenEntity={onOpenEntity} />}

      {open.map(c => (
        <div key={c.key} className="flex items-center justify-between gap-3 rounded border border-warning px-3 py-2 text-xs">
          <span className="flex items-center gap-1.5">
            <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
            {c.attribute} has conflicting values ({c.versions.length} versions)
          </span>
          <button type="button" className={btn} onClick={() => onShowConflict?.(c.key)}>Show in conflict queue</button>
        </div>
      ))}

      {section('Kept', kept, keptGroups.map(([key, group]) => {
        const c = contradictions.find(x => x.key === contradictionKey(entity.id, key));
        return (
          <div key={key} className="flex flex-col gap-1">
            <h4 className="text-xs font-semibold">{group[0].attribute}</h4>
            {c?.acknowledgedBy && (
              <p className="text-[11px] text-content-muted">
                multiple versions kept{c.acknowledgedBy.note ? `: ${c.acknowledgedBy.note}` : ''}
              </p>
            )}
            <ul className="flex flex-col gap-1.5">{group.map(f => row(f, 'kept', false))}</ul>
          </div>
        );
      }))}

      {section('Pending', pending, <ul className="flex flex-col gap-1.5">{pending.map(f => row(f, 'pending', true))}</ul>)}

      {aside.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <button
            type="button" className="flex items-center gap-1 self-start text-xs text-content-muted hover:text-content"
            aria-expanded={showAside} onClick={() => setShowAside(s => !s)}
          >
            {showAside ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
            Set aside ({aside.length})
          </button>
          {showAside && <ul className="flex flex-col gap-1.5">{aside.map(f => row(f, 'set_aside', true))}</ul>}
        </div>
      )}

      {facts.length === 0 && !adding && <p className="text-xs text-content-muted">No facts yet.</p>}
    </div>
  );
}
