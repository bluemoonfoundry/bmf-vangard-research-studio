import { useState } from 'react';
import type { EntityKind, Fact, FactSource, StoryPosition, TreeItem } from '@/project/types';
import type { SourceState } from '@/bible/sources';
import { formatPosition } from '@/bible/normalize';
import { FactForm } from '@/components/bible/FactForm';
import { SourceLink } from '@/components/bible/SourceLink';
import { btn } from '@/components/workspace/ui';

export type FactRowSection = 'kept' | 'pending' | 'set_aside';

export interface FactRowProps {
  fact: Fact;
  section: FactRowSection;
  /** Kept rows sit under an attribute heading, so they omit the attribute. */
  showAttribute: boolean;
  entity: TreeItem;
  attributeSuggestions(kind: EntityKind | null): string[];
  sourceState: SourceState | null;
  sourceTitle?: string;
  onKeep(): void;
  onSetAside(): void;
  onRestore(): void;
  onUnreview(): void;
  onEdit(attribute: string, value: string | StoryPosition): void;
  onOpenSource(source: FactSource): void;
}

export const valueText = (v: string | StoryPosition): string => (typeof v === 'string' ? v : formatPosition(v));

export function FactRow(props: FactRowProps) {
  const { fact, section, showAttribute, entity, sourceState, sourceTitle } = props;
  const [editing, setEditing] = useState(false);

  if (editing) {
    return (
      <li>
        <FactForm
          entities={[entity]}
          fixedEntityId={entity.id}
          source={fact.source}
          initial={{ attribute: fact.attribute, value: fact.value }}
          attributeSuggestions={props.attributeSuggestions}
          onSubmit={(f) => { props.onEdit(f.attribute, f.value); setEditing(false); }}
          onCancel={() => setEditing(false)}
        />
      </li>
    );
  }

  return (
    <li className="flex items-start justify-between gap-3 rounded border border-line bg-surface-raised px-3 py-2 text-xs">
      <div className="flex min-w-0 flex-col gap-1">
        <span>
          {showAttribute && <span className="mr-2 font-semibold">{fact.attribute}</span>}
          <span>{valueText(fact.value)}</span>
        </span>
        {fact.source && sourceState && (
          <SourceLink source={fact.source} state={sourceState} title={sourceTitle} onOpen={() => props.onOpenSource(fact.source!)} />
        )}
        {fact.note && <p className="text-[11px] text-content-muted">{fact.note}</p>}
      </div>
      <div className="flex shrink-0 gap-1.5">
        {section === 'pending' && (
          <>
            <button type="button" className={btn} onClick={props.onKeep}>Keep</button>
            <button type="button" className={btn} onClick={props.onSetAside}>Set aside</button>
          </>
        )}
        {section === 'kept' && <button type="button" className={btn} onClick={props.onUnreview}>Mark unreviewed</button>}
        {section === 'set_aside' && <button type="button" className={btn} onClick={props.onRestore}>Restore</button>}
        <button type="button" className={btn} onClick={() => setEditing(true)}>Edit</button>
      </div>
    </li>
  );
}
