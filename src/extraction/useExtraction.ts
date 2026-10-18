import { useCallback, useEffect, useRef, useState } from 'react';
import type { AiApi } from '@/ai/aiApi';
import type { ModelInfo, ProviderId, RawProposal } from '@/ai/types';
import type { ProjectController } from '@/project/useProject';
import type { ProjectState } from '@/project/projectState';
import { applyResults, type ApplySummary } from '@/extraction/apply';
import { buildExtractRequest, cacheKey, EXTRACTION_SYSTEM, extractionCanon, sourceBudgetChars } from '@/extraction/request';
import { chunkTurns, extractionSource, sourceTextFor, type ExtractionSource } from '@/extraction/sourceText';
import type { CachedRun } from '@/extraction/types';

/**
 * Runs an extraction over chosen sources, one after another. Per source: an unchanged source with the
 * same model reuses its cached results (no request); otherwise each chunk is requested in turn, then
 * the results are cached and applied in one change to the bible and extraction state. An error or a
 * cancel stops the run; nothing from the source it stopped on is applied.
 */

export type RunState = 'waiting' | 'cached' | 'running' | 'done' | 'error' | 'cancelled';

export interface RunSourceStatus {
  itemId: string;
  title: string;
  state: RunState;
  message?: string;
  summary?: ApplySummary;
}

export interface ExtractionRun {
  running: boolean;
  statuses: RunSourceStatus[];
  start(ids: string[], provider: ProviderId, model: ModelInfo): void;
  cancel(): void;
}

/** Extra characters a request carries besides the system prompt, canon and source text. */
const REQUEST_OVERHEAD = 500;
const CHARS_PER_TOKEN = 4;

interface Plan { source: ExtractionSource; text: string; key: string; cached: CachedRun | undefined }

function planSource(state: ProjectState, id: string, provider: ProviderId, modelId: string): Plan | null {
  const item = state.tree.items.find(i => i.id === id);
  if (!item) return null;
  const source = extractionSource(item, state.docs[id]?.current, state.chats[id]?.current);
  if (!source || !source.turns.length) return null;
  const text = sourceTextFor(source.turns);
  const key = cacheKey(text, provider, modelId);
  return { source, text, key, cached: state.extraction.runs.find(r => r.itemId === id && r.key === key) };
}

/** What the dialog shows before a run: approximate tokens to send, and how many sources are cached. */
export function estimateRun(state: ProjectState, ids: string[], provider: ProviderId, model: ModelInfo): { tokens: number; cached: number; empty: number } {
  let chars = 0;
  let cached = 0;
  let empty = 0;
  for (const id of ids) {
    const plan = planSource(state, id, provider, model.id);
    if (!plan) { empty++; continue; }
    if (plan.cached) { cached++; continue; }
    chars += plan.text.length + EXTRACTION_SYSTEM.length + REQUEST_OVERHEAD
      + extractionCanon(state.tree.items, state.bible, state.extraction, plan.text).length;
  }
  return { tokens: Math.ceil(chars / CHARS_PER_TOKEN), cached, empty };
}

const messageOf = (err: unknown) => (err instanceof Error ? err.message : String(err));
const codeOf = (err: unknown) => (typeof (err as { code?: unknown })?.code === 'string' ? (err as { code: string }).code : '');

export function useExtraction({ ai, project }: { ai: AiApi | null; project: ProjectController }): ExtractionRun {
  const [running, setRunning] = useState(false);
  const [statuses, setStatuses] = useState<RunSourceStatus[]>([]);
  const projectRef = useRef(project);
  projectRef.current = project;
  /** The run in flight: its cancel flag, the request being awaited, and how to stop waiting for it. */
  const active = useRef<{ cancelled: boolean; requestId: string | null; stop: (() => void) | null } | null>(null);

  const setStatus = (itemId: string, patch: Partial<RunSourceStatus>) =>
    setStatuses(list => list.map(s => (s.itemId === itemId ? { ...s, ...patch } : s)));

  const cancel = useCallback(() => {
    const run = active.current;
    if (!run || run.cancelled) return;
    run.cancelled = true;
    if (run.requestId && ai) void ai.cancelExtract(run.requestId).catch(() => {});
    run.stop?.();
  }, [ai]);

  // Turning AI off ends the run (the main process aborts the request as well).
  useEffect(() => {
    if (!ai) cancel();
  }, [ai, cancel]);
  useEffect(() => () => cancel(), [cancel]);

  const start = useCallback((ids: string[], provider: ProviderId, model: ModelInfo) => {
    if (!ai || active.current) return;
    const run = { cancelled: false, requestId: null as string | null, stop: null as (() => void) | null };
    active.current = run;
    const titleOf = (id: string) => projectRef.current.state?.tree.items.find(i => i.id === id)?.title || 'Untitled';
    setStatuses(ids.map(id => ({ itemId: id, title: titleOf(id), state: 'waiting' })));
    setRunning(true);

    /** Awaits one request, giving up at once when the run is cancelled. */
    const request = (requestId: string, req: Parameters<AiApi['extract']>[1]) => new Promise<Awaited<ReturnType<AiApi['extract']>>>((resolve, reject) => {
      run.requestId = requestId;
      run.stop = () => reject(Object.assign(new Error('Cancelled'), { code: 'CANCELLED' }));
      ai.extract(requestId, req).then(resolve, reject);
    });

    void (async () => {
      for (const id of ids) {
        if (run.cancelled) break;
        const state = projectRef.current.state;
        const plan = state && planSource(state, id, provider, model.id);
        if (!state || !plan) { setStatus(id, { state: 'error', message: 'Nothing to read in this source yet.' }); continue; }
        let proposals: RawProposal[];
        let dropped: number;
        if (plan.cached) {
          ({ proposals, dropped } = plan.cached);
        } else {
          setStatus(id, { state: 'running' });
          try {
            const canon = extractionCanon(state.tree.items, state.bible, state.extraction, plan.text);
            const budget = sourceBudgetChars(model.inputTokenLimit, EXTRACTION_SYSTEM.length + canon.length + REQUEST_OVERHEAD);
            const chunks = chunkTurns(plan.source.turns, budget);
            proposals = [];
            dropped = 0;
            let summary = '';
            for (let i = 0; i < chunks.length; i++) {
              const res = await request(crypto.randomUUID(), buildExtractRequest({
                provider, model: model.id, canon, source: plan.source, chunk: chunks[i], chunkIndex: i, chunkCount: chunks.length, summary,
              }));
              proposals.push(...res.proposals);
              dropped += res.dropped;
              summary = res.summary || summary;
            }
          } catch (err) {
            const cancelled = run.cancelled || codeOf(err) === 'CANCELLED';
            setStatus(id, cancelled ? { state: 'cancelled' } : { state: 'error', message: messageOf(err) });
            break;
          } finally {
            run.requestId = null;
            run.stop = null;
          }
        }
        if (run.cancelled) { setStatus(id, { state: 'cancelled' }); break; }

        const latest = projectRef.current.state ?? state;
        const fresh = latest.tree.items.find(i => i.id === id);
        if (!fresh) { setStatus(id, { state: 'error', message: 'The source was deleted.' }); continue; }
        const source = { ...plan.source, item: fresh };
        const now = new Date().toISOString();
        const cachedRun: CachedRun = plan.cached ?? { itemId: id, key: plan.key, provider, model: model.id, at: now, proposals, dropped };
        const preview = applyResults({ items: latest.tree.items, bible: latest.bible, extraction: latest.extraction, source, now, newId: () => crypto.randomUUID() }, proposals);
        projectRef.current.updateCanon(c => {
          const r = applyResults({ items: projectRef.current.state?.tree.items ?? latest.tree.items, ...c, source, now, newId: () => crypto.randomUUID() }, proposals);
          if (plan.cached) return { bible: r.bible, extraction: r.extraction };
          return { bible: r.bible, extraction: { ...r.extraction, runs: [...r.extraction.runs.filter(x => x.itemId !== id), cachedRun] } };
        });
        setStatus(id, { state: plan.cached ? 'cached' : 'done', summary: { ...preview.summary, dropped: preview.summary.dropped + dropped } });
      }
      active.current = null;
      setRunning(false);
    })();
  }, [ai]);

  return { running, statuses, start, cancel };
}
