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

  const best = body.indexOf(quote);
  return best === -1 ? { status: 'missing' } : { status: 'relocated', start: best, end: best + quote.length };
}
