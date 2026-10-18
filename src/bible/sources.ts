import type { FactSource } from '@/project/types';
import type { ChatTranscript } from '@/chat/types';

export type SourceState =
  | { status: 'exact' | 'relocated'; start: number; end: number }
  | { status: 'missing' | 'deleted' };

/**
 * Finds where a fact's quote sits in its source body now. An undefined body means "not loaded yet";
 * null means the cited passage's container is gone (a deleted chat message).
 */
export function resolveSource(source: FactSource, body: string | null | undefined, itemExists: boolean): SourceState {
  if (!itemExists) return { status: 'deleted' };
  if (body === undefined) return { status: 'exact', start: source.start, end: source.end };
  if (body === null) return { status: 'missing' };
  const { quote } = source;
  if (quote === '') return { status: 'missing' };
  if (body.slice(source.start, source.end) === quote) return { status: 'exact', start: source.start, end: source.end };

  const best = body.indexOf(quote);
  return best === -1 ? { status: 'missing' } : { status: 'relocated', start: best, end: best + quote.length };
}

/**
 * The text a source's offsets point into: the item's body, or the cited AI Chat message's text.
 * undefined = not loaded yet; null = the message was deleted.
 */
export function sourceText(
  source: FactSource,
  bodyOf: (id: string) => string | undefined,
  chatOf: (id: string) => ChatTranscript | undefined,
): string | null | undefined {
  if (source.messageId === undefined) return bodyOf(source.itemId);
  const chat = chatOf(source.itemId);
  if (!chat) return undefined;
  return chat.messages.find(m => m.id === source.messageId)?.text ?? null;
}
