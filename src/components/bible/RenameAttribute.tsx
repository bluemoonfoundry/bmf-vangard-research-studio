import { useId, useState } from 'react';
import type { Bible } from '@/project/types';
import { attributeKey } from '@/bible/normalize';
import { renameCheck, renameCounts } from '@/bible/rename';
import { btn, btnPrimary, fieldLabel, input } from '@/components/workspace/ui';

export interface RenameAttributeFormProps {
  attribute: string;
  entityId: string;
  bible: Bible;
  /** Attribute names to offer (merging into one of them is the usual reason to rename). */
  suggestions: string[];
  onRename(to: string, everywhere: boolean): void;
  onCancel(): void;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Renames an attribute on this entity or on every entity; a name already in use merges the two. */
export function RenameAttributeForm({ attribute, entityId, bible, suggestions, onRename, onCancel }: RenameAttributeFormProps) {
  const listId = useId();
  const [to, setTo] = useState(attribute);
  const [everywhere, setEverywhere] = useState(false);
  const [error, setError] = useState('');

  const scope = everywhere ? null : new Set([entityId]);
  const counts = renameCounts(bible, attribute, scope);
  const target = to.trim();
  const merges = target !== '' && attributeKey(target) !== attributeKey(attribute)
    && bible.facts.some(f => (scope === null || scope.has(f.entityId)) && attributeKey(f.attribute) === attributeKey(target));

  const submit = () => {
    const problem = renameCheck(bible, attribute, to, scope);
    if (problem) return setError(problem);
    onRename(target, everywhere);
  };

  return (
    <form
      className="flex flex-col gap-2 rounded-md border border-line bg-surface-raised p-3 text-xs"
      onSubmit={(e) => { e.preventDefault(); submit(); }}
    >
      <label className="flex flex-col gap-1">
        <span className={fieldLabel}>New name</span>
        <input aria-label="New name" list={listId} className={input} value={to} onChange={(e) => { setTo(e.target.value); setError(''); }} />
        <datalist id={listId}>
          {suggestions.filter(s => attributeKey(s) !== attributeKey(attribute)).map(s => <option key={s} value={s} />)}
        </datalist>
      </label>
      <label className="flex items-center gap-2">
        <input type="checkbox" checked={everywhere} onChange={(e) => { setEverywhere(e.target.checked); setError(''); }} />
        Rename on every entity
      </label>
      <p className="text-content-muted">
        {everywhere
          ? `Renames ${plural(counts.facts, 'fact', 'facts')} on ${plural(counts.entities, 'entity', 'entities')}.`
          : `Renames ${plural(counts.facts, 'fact', 'facts')} on this entity.`}
      </p>
      {merges && <p className="text-content-muted">Merges into the existing "{target}".</p>}
      {error && <p role="alert" className="text-danger">{error}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" className={btn} onClick={onCancel}>Cancel</button>
        <button type="submit" className={btnPrimary}>Rename</button>
      </div>
    </form>
  );
}
