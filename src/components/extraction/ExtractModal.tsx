import { useMemo, useState } from 'react';
import type { ModelInfo, ProviderId } from '@/ai/types';
import type { TreeItem } from '@/project/types';
import type { ApplySummary } from '@/extraction/apply';
import type { ExtractionRun, RunSourceStatus } from '@/extraction/useExtraction';
import { Modal } from '@/components/workspace/Modal';
import { ModelPicker, useModelChoice, type ModelSource } from '@/components/extraction/ModelPicker';
import { btn, btnPrimary, fieldLabel } from '@/components/workspace/ui';

export interface ExtractModalProps extends ModelSource {
  /** Chats, AI chats and documents, oldest first. */
  sources: TreeItem[];
  initialIds: string[];
  /** False for a source with no turn structure. */
  hasTurns(id: string): boolean;
  estimate(ids: string[], provider: ProviderId, model: ModelInfo): { tokens: number; cached: number; empty: number };
  run: ExtractionRun;
  onSetOwnWriting(id: string, value: boolean): void;
  onReview(): void;
  onClose(): void;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

/** "2 to review · 3 suggested · 1 new card", leaving out zeros. */
export function summaryText(s: ApplySummary): string {
  const parts = [
    s.facts && `${s.facts} to review`,
    s.suggested && `${s.suggested} suggested`,
    s.cards && plural(s.cards, 'new card'),
    s.merged && `${s.merged} merged`,
    s.skipped && `${s.skipped} already decided`,
    s.dropped && `${s.dropped} dropped`,
  ].filter(Boolean);
  return parts.length ? parts.join(' · ') : 'Nothing new';
}

function statusText(s: RunSourceStatus): string {
  switch (s.state) {
    case 'waiting': return 'Waiting';
    case 'running': return 'Reading…';
    case 'cancelled': return 'Cancelled';
    case 'error': return s.message ?? 'Failed';
    case 'cached': return s.summary ? `From the last run: ${summaryText(s.summary)}` : 'From the last run';
    case 'done': return s.summary ? summaryText(s.summary) : 'Done';
  }
}

/**
 * Chooses sources and a model, shows an estimate, then the run's progress. AI only: Workspace mounts
 * it only while AI is on. The run itself lives in Workspace, so closing this doesn't stop it.
 */
export function ExtractModal(props: ExtractModalProps) {
  const { sources, configuredProviders, run } = props;
  const [chosen, setChosen] = useState<string[]>(props.initialIds);
  const choice = useModelChoice(props);
  const { provider, model } = choice;
  const ids = sources.map(s => s.id).filter(id => chosen.includes(id));
  const estimate = useMemo(
    () => (provider && model && ids.length ? props.estimate(ids, provider, model) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- recomputed when the choice changes
    [provider, model, ids.join('|')],
  );
  // Progress shows for a run started here or still going; a finished earlier run opens on the picker.
  const [watching, setWatching] = useState(run.running);
  const started = watching || run.running;
  const toggle = (id: string) => setChosen(c => (c.includes(id) ? c.filter(x => x !== id) : [...c, id]));
  const totals = run.statuses.reduce<ApplySummary>((t, s) => {
    if (!s.summary) return t;
    for (const k of Object.keys(t) as (keyof ApplySummary)[]) t[k] += s.summary[k];
    return t;
  }, { facts: 0, merged: 0, suggested: 0, cards: 0, skipped: 0, dropped: 0 });

  const footer = run.running ? (
    <>
      <button type="button" className={btn} onClick={props.onClose}>Hide</button>
      <button type="button" className={btn} onClick={run.cancel}>Cancel run</button>
    </>
  ) : started ? (
    <>
      <button type="button" className={btn} onClick={props.onClose}>Close</button>
      <button type="button" className={btnPrimary} onClick={props.onReview}>Review</button>
    </>
  ) : (
    <>
      <button type="button" className={btn} onClick={props.onClose}>Cancel</button>
      <button
        type="button"
        className={btnPrimary}
        disabled={!ids.length || !provider || !model}
        onClick={() => {
          if (!provider || !model) return;
          run.start(ids, provider, model);
          setWatching(true);
        }}
      >
        Start
      </button>
    </>
  );

  return (
    <Modal
      title="Extract facts"
      description="The AI reads the chosen sources and proposes facts and new cards. Nothing becomes canon until you keep it."
      onClose={props.onClose}
      footer={footer}
      width="max-w-2xl"
    >
      {started ? (
        <div className="flex flex-col gap-3 text-xs">
          <ul className="flex flex-col divide-y divide-line rounded border border-line">
            {run.statuses.map(s => (
              <li key={s.itemId} className="flex items-baseline justify-between gap-3 px-3 py-1.5">
                <span className="truncate font-semibold">{s.title}</span>
                <span className={s.state === 'error' ? 'text-danger' : 'text-content-muted'}>{statusText(s)}</span>
              </li>
            ))}
          </ul>
          {!run.running && <p>In all: {summaryText(totals)}</p>}
        </div>
      ) : (
        <div className="flex flex-col gap-4 text-xs">
          <fieldset className="flex flex-col gap-1.5">
            <legend className={fieldLabel}>Sources</legend>
            {sources.length === 0 && <p className="text-content-muted">Import a chat or write a document first.</p>}
            <ul className="flex max-h-72 flex-col divide-y divide-line overflow-y-auto rounded border border-line">
              {sources.map(s => {
                const title = s.title || 'Untitled';
                const noTurns = !props.hasTurns(s.id);
                return (
                  <li key={s.id} className="flex flex-col gap-1 px-3 py-1.5">
                    <label className="flex items-center gap-2">
                      <input type="checkbox" checked={chosen.includes(s.id)} onChange={() => toggle(s.id)} aria-label={title} />
                      <span className="truncate">{title}</span>
                    </label>
                    {noTurns && (
                      <div className="ml-6 flex flex-col gap-1 text-content-muted">
                        <span>No turns found: proposals will be suggestions unless this is your own writing.</span>
                        <label className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={s.ownWriting === true}
                            aria-label={`${title} is my own writing`}
                            onChange={(e) => props.onSetOwnWriting(s.id, e.target.checked)}
                          />
                          This is my own writing
                        </label>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </fieldset>

          <ModelPicker choice={choice} configuredProviders={configuredProviders} />

          {estimate && model && (
            <p className="text-content-muted">
              {plural(ids.length, 'source')} · ~{estimate.tokens.toLocaleString()} tokens · {estimate.cached} cached · {model.name}
            </p>
          )}
        </div>
      )}
    </Modal>
  );
}
