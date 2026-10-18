import { AlertTriangle, X } from 'lucide-react';
import type { ProviderId } from '@/ai/types';
import type { ConflictFlag } from '@/extraction/types';
import type { TreeItem } from '@/project/types';
import { factValueText, MAX_CHECK_FACTS, type LiveFlag } from '@/extraction/conflictCheck';
import type { ConflictCheckRun } from '@/extraction/useConflictCheck';
import { Modal } from '@/components/workspace/Modal';
import { ModelPicker, useModelChoice, type ModelSource } from '@/components/extraction/ModelPicker';
import { btn, btnGhost, btnPrimary } from '@/components/workspace/ui';

/** The semantic conflict check's UI (AI only): its dialog and the list of flags it raised. */

export interface ConflictFlagListProps {
  flags: LiveFlag[];
  items: TreeItem[];
  onDismiss(flag: ConflictFlag): void;
  onSetAside(factId: string): void;
  onOpenCard(entityId: string): void;
  /** The card being shown: its title is plain text, not a link. */
  currentEntityId?: string;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

/** Advisory flags: both facts with their entities, the AI's reason, and Dismiss (sticky). */
export function ConflictFlagList({ flags, items, onDismiss, onSetAside, onOpenCard, currentEntityId }: ConflictFlagListProps) {
  const titleOf = (id: string) => items.find(i => i.id === id)?.title || 'Untitled';
  return (
    <ul aria-label="Possible conflicts" className="flex flex-col gap-2 text-xs">
      {flags.map(({ flag, facts }) => (
        <li key={flag.id} className="flex flex-col gap-1.5 rounded border border-dashed border-warning p-2.5">
          <span className="flex items-start justify-between gap-2">
            <span className="flex items-start gap-1.5">
              <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-warning" aria-hidden />
              <span>{flag.reason}</span>
            </span>
            <button type="button" className={btnGhost} title="Not a conflict: never flag this pair again" onClick={() => onDismiss(flag)}>
              <X className="h-3 w-3" /> Dismiss
            </button>
          </span>
          <ul className="flex flex-col gap-1 pl-4">
            {facts.map(f => {
              const label = `${f.attribute}: ${factValueText(f.value)}`;
              return (
                <li key={f.id} className="flex flex-wrap items-baseline gap-x-2">
                  {f.entityId === currentEntityId
                    ? <span className="font-semibold">{titleOf(f.entityId)}</span>
                    : <button type="button" className="font-semibold text-accent hover:underline" onClick={() => onOpenCard(f.entityId)}>{titleOf(f.entityId)}</button>}
                  <span>{label}</span>
                  {f.status === 'proposed' && <span className="text-[11px] text-content-muted">to review</span>}
                  <button type="button" className={`${btnGhost} ml-auto`} aria-label={`Set aside ${label}`} onClick={() => onSetAside(f.id)}>
                    Set aside
                  </button>
                </li>
              );
            })}
          </ul>
        </li>
      ))}
    </ul>
  );
}

export interface ConflictCheckModalProps extends ModelSource, Omit<ConflictFlagListProps, 'flags' | 'currentEntityId'> {
  /** "Mara", "Characters". */
  scopeLabel: string;
  estimate: { facts: number; total: number; tokens: number };
  check: ConflictCheckRun;
  /** The scope's live flags, shown once the check is done. */
  flags: LiveFlag[];
  onStart(provider: ProviderId, model: string): void;
  onClose(): void;
}

export function ConflictCheckModal(props: ConflictCheckModalProps) {
  const { scopeLabel, estimate, check, configuredProviders } = props;
  const choice = useModelChoice(props);
  const { provider, model } = choice;
  const { state } = check.status;

  const footer = state === 'running' ? (
    <button type="button" className={btn} onClick={check.cancel}>Cancel check</button>
  ) : state === 'idle' ? (
    <>
      <button type="button" className={btn} onClick={props.onClose}>Cancel</button>
      <button
        type="button"
        className={btnPrimary}
        disabled={!provider || !model || estimate.facts < 2}
        onClick={() => provider && model && props.onStart(provider, model.id)}
      >
        Start
      </button>
    </>
  ) : (
    <button type="button" className={btn} onClick={props.onClose}>Close</button>
  );

  return (
    <Modal
      title={`Check for conflicts: ${scopeLabel}`}
      description="The AI looks for facts that can't all be true, beyond exact differences. Flags are advice: nothing changes unless you act on it."
      onClose={props.onClose}
      footer={footer}
      width="max-w-2xl"
    >
      <div className="flex flex-col gap-3 text-xs">
        {state === 'idle' && (
          <>
            <ModelPicker choice={choice} configuredProviders={configuredProviders} />
            {estimate.facts < 2
              ? <p className="text-content-muted">There need to be at least two facts to check.</p>
              : model && <p className="text-content-muted">{plural(estimate.facts, 'fact')} · ~{estimate.tokens.toLocaleString()} tokens · {model.name}</p>}
            {estimate.total > estimate.facts && (
              <p className="text-content-muted">
                Only the first {MAX_CHECK_FACTS.toLocaleString()} of {estimate.total.toLocaleString()} facts are checked, kept ones first. Check a single card to cover the rest.
              </p>
            )}
          </>
        )}
        {state === 'running' && <p className="text-content-muted">Checking…</p>}
        {state === 'cancelled' && <p className="text-content-muted">Cancelled. Nothing was changed.</p>}
        {state === 'error' && <p className="text-danger">{check.status.message}</p>}
        {state === 'done' && (
          <>
            <p>{check.status.added ? `${plural(check.status.added, 'new possible conflict')}.` : 'No new conflicts found.'}</p>
            {props.flags.length > 0 && (
              <ConflictFlagList flags={props.flags} items={props.items} onDismiss={props.onDismiss} onSetAside={props.onSetAside} onOpenCard={props.onOpenCard} />
            )}
          </>
        )}
      </div>
    </Modal>
  );
}
