import { useCallback, useEffect, useRef, useState } from 'react';
import type { AiApi } from '@/ai/aiApi';
import type { ProviderId } from '@/ai/types';
import type { ProjectController } from '@/project/useProject';
import { applyConflictCheck, buildConflictRequest, checkFacts } from '@/extraction/conflictCheck';

/**
 * Runs one semantic conflict check at a time over a scope of entities. The flags are applied in one
 * change to the extraction state when the reply arrives; an error or a cancel applies nothing.
 */

export interface ConflictCheckStatus {
  state: 'idle' | 'running' | 'done' | 'error' | 'cancelled';
  message?: string;
  /** New flags from the finished check. */
  added?: number;
}

export interface ConflictCheckRun {
  status: ConflictCheckStatus;
  start(entityIds: string[], provider: ProviderId, model: string): void;
  cancel(): void;
  /** Back to idle, for the next dialog. */
  reset(): void;
}

const messageOf = (err: unknown) => (err instanceof Error ? err.message : String(err));
const codeOf = (err: unknown) => (typeof (err as { code?: unknown })?.code === 'string' ? (err as { code: string }).code : '');

export function useConflictCheck({ ai, project }: { ai: AiApi | null; project: ProjectController }): ConflictCheckRun {
  const [status, setStatus] = useState<ConflictCheckStatus>({ state: 'idle' });
  const projectRef = useRef(project);
  projectRef.current = project;
  const active = useRef<{ cancelled: boolean; requestId: string; stop(): void } | null>(null);

  const cancel = useCallback(() => {
    const run = active.current;
    if (!run || run.cancelled) return;
    run.cancelled = true;
    if (ai) void ai.cancelConflictCheck(run.requestId).catch(() => {});
    run.stop();
  }, [ai]);

  // Turning AI off ends the check (the main process aborts the request as well).
  useEffect(() => {
    if (!ai) cancel();
  }, [ai, cancel]);
  useEffect(() => () => cancel(), [cancel]);

  const start = useCallback((entityIds: string[], provider: ProviderId, model: string) => {
    const state = projectRef.current.state;
    if (!ai || !state || active.current) return;
    const { facts } = checkFacts(state.bible, entityIds);
    if (facts.length < 2) {
      setStatus({ state: 'error', message: facts.length ? 'There is only one fact to check.' : 'There are no facts to check.' });
      return;
    }
    const { request, refs } = buildConflictRequest({ provider, model, items: state.tree.items, facts });
    const requestId = crypto.randomUUID();
    let stop = () => {};
    const run = { cancelled: false, requestId, stop: () => stop() };
    active.current = run;
    setStatus({ state: 'running' });

    void (async () => {
      try {
        const result = await new Promise<Awaited<ReturnType<AiApi['conflictCheck']>>>((resolve, reject) => {
          stop = () => reject(Object.assign(new Error('Cancelled'), { code: 'CANCELLED' }));
          ai.conflictCheck(requestId, request).then(resolve, reject);
        });
        if (run.cancelled) throw Object.assign(new Error('Cancelled'), { code: 'CANCELLED' });
        const now = new Date().toISOString();
        const apply = (c: { bible: typeof state.bible; extraction: typeof state.extraction }) => applyConflictCheck({
          extraction: c.extraction, bible: c.bible, checkedFactIds: facts.map(f => f.id), refs,
          conflicts: result.conflicts, now, newId: () => crypto.randomUUID(),
        });
        const latest = projectRef.current.state ?? state;
        const { added } = apply(latest);
        projectRef.current.updateCanon(c => ({ ...c, extraction: apply(c).extraction }));
        setStatus({ state: 'done', added });
      } catch (err) {
        setStatus(run.cancelled || codeOf(err) === 'CANCELLED' ? { state: 'cancelled' } : { state: 'error', message: messageOf(err) });
      } finally {
        active.current = null;
      }
    })();
  }, [ai]);

  const reset = useCallback(() => {
    if (!active.current) setStatus({ state: 'idle' });
  }, []);

  return { status, start, cancel, reset };
}
