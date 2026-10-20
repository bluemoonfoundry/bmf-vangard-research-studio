import { useId, useState } from 'react';
import type { EntityKind, FactSource, FactValue, TreeItem } from '@/project/types';
import { ENTITY_KINDS, entityKindOf } from '@/bible/entities';
import { isPosition, isWhenAttribute } from '@/bible/normalize';
import { PositionFields, emptyPositionDraft, parsePositionDraft, type PositionDraft } from '@/components/bible/PositionFields';
import { btn, btnPrimary, fieldLabel, input } from '@/components/workspace/ui';

export interface FactFormValue {
  entityId?: string;
  newEntity?: { title: string; kind: EntityKind };
  attribute: string;
  value: FactValue;
}

export interface FactFormProps {
  entities: TreeItem[];
  fixedEntityId?: string;
  source?: FactSource;
  /** Prefill when editing an existing fact. */
  initial?: { attribute: string; value: FactValue };
  attributeSuggestions(kind: EntityKind | null): string[];
  onSubmit(f: FactFormValue): void;
  onCancel(): void;
}

const NEW = '__new__';

const draftOf = (v: FactValue | undefined): PositionDraft =>
  (v !== undefined && isPosition(v)
    ? { season: String(v.season), episode: v.episode === undefined ? '' : String(v.episode), order: v.order === undefined ? '' : String(v.order) }
    : emptyPositionDraft());

export function FactForm({ entities, fixedEntityId, source, initial, attributeSuggestions, onSubmit, onCancel }: FactFormProps) {
  const suggestionsId = useId();
  const [entityId, setEntityId] = useState(fixedEntityId ?? entities[0]?.id ?? NEW);
  const [newTitle, setNewTitle] = useState('');
  const [newKind, setNewKind] = useState<EntityKind>('character');
  const [attribute, setAttribute] = useState(initial?.attribute ?? '');
  const [text, setText] = useState(typeof initial?.value === 'string' ? initial.value : '');
  const [position, setPosition] = useState(draftOf(initial?.value));
  const [error, setError] = useState('');

  const entity = entities.find(e => e.id === entityId);
  const kind = entityId === NEW ? newKind : entity ? entityKindOf(entity) : null;
  const when = isWhenAttribute(attribute);

  const submit = () => {
    const attr = attribute.trim();
    if (!attr) return setError('Enter an attribute.');
    if (entityId === NEW && !newTitle.trim()) return setError('Name the new entity.');
    let value: FactValue;
    if (when) {
      const p = parsePositionDraft(position);
      if (!p) return setError('Season must be a whole number of 1 or more, episode likewise, and order a number.');
      value = p;
    } else {
      if (!text.trim()) return setError('Enter a value.');
      value = text.trim();
    }
    onSubmit({
      ...(entityId === NEW ? { newEntity: { title: newTitle.trim(), kind: newKind } } : { entityId }),
      attribute: attr,
      value,
    });
  };

  return (
    <form
      className="flex flex-col gap-2 rounded-md border border-line bg-surface-raised p-3"
      onSubmit={(e) => { e.preventDefault(); submit(); }}
    >
      {!fixedEntityId && (
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1">
            <span className={fieldLabel}>Entity</span>
            <select aria-label="Entity" className={input} value={entityId} onChange={(e) => setEntityId(e.target.value)}>
              {entities.map(e => <option key={e.id} value={e.id}>{e.title || 'Untitled'}</option>)}
              <option value={NEW}>New entity…</option>
            </select>
          </label>
          {entityId === NEW && (
            <>
              <input aria-label="New entity name" className={input} placeholder="Name" value={newTitle} onChange={(e) => setNewTitle(e.target.value)} />
              <select aria-label="New entity kind" className={input} value={newKind} onChange={(e) => setNewKind(e.target.value as EntityKind)}>
                {ENTITY_KINDS.map(k => <option key={k.id} value={k.id}>{k.name}</option>)}
              </select>
            </>
          )}
        </div>
      )}
      <label className="flex flex-col gap-1">
        <span className={fieldLabel}>Attribute</span>
        <input
          aria-label="Attribute" list={suggestionsId} className={input}
          value={attribute} onChange={(e) => setAttribute(e.target.value)}
        />
        <datalist id={suggestionsId}>
          {attributeSuggestions(kind).map(a => <option key={a} value={a} />)}
        </datalist>
      </label>
      {when ? (
        <PositionFields value={position} onChange={setPosition} />
      ) : (
        <label className="flex flex-col gap-1">
          <span className={fieldLabel}>Value</span>
          <textarea aria-label="Value" rows={2} className={input} value={text} onChange={(e) => setText(e.target.value)} />
        </label>
      )}
      {source && <q className="text-[11px] italic text-content-muted">{source.quote}</q>}
      {error && <p role="alert" className="text-[11px] text-danger">{error}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" className={btn} onClick={onCancel}>Cancel</button>
        <button type="submit" className={btnPrimary}>Save fact</button>
      </div>
    </form>
  );
}
