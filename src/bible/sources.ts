import type { FactSource } from '@/project/types';

export type SourceState =
  | { status: 'exact' | 'relocated'; start: number; end: number }
  | { status: 'missing' | 'deleted' };

/** Finds where a fact's quote sits in its source body now. An undefined body means "not loaded yet". */
export function resolveSource(source: FactSource, body: string | undefined, itemExists: boolean): SourceState {
  if (!itemExists) return { status: 'deleted' };
  if (body === undefined) return { status: 'exact', start: source.start, end: source.end };
  const { quote } = source;
  if (quote === '') return { status: 'missing' };
  if (body.slice(source.start, source.end) === quote) return { status: 'exact', start: source.start, end: source.end };

  let best = -1;
  for (let i = body.indexOf(quote); i !== -1; i = body.indexOf(quote, i + 1)) {
    if (best === -1 || Math.abs(i - source.start) < Math.abs(best - source.start)) best = i;
  }
  return best === -1 ? { status: 'missing' } : { status: 'relocated', start: best, end: best + quote.length };
}
