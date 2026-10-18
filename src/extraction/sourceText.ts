import type { FactSource, TreeItem } from '@/project/types';
import type { ChatTranscript } from '@/chat/types';
import { exporterTurnSpans, turnSpans } from '@/chat/importFormats';
import { AI_CHAT_TYPE } from '@/project/projectState';

/**
 * What an extraction reads from one source: its turns, numbered as the model sees them, each with
 * where its text sits in the stored body (or, for an AI Chat, which message it is). Evidence quotes
 * are located back in these turns, so fact offsets follow the bible's source rules.
 */

export interface SourceTurn {
  /** 1-based, as shown to the model. */
  index: number;
  /** 'unknown' for a source with no turns (its whole text is one turn). */
  role: 'user' | 'model' | 'unknown';
  label: string;
  text: string;
  /** Where `text` starts in the stored body; 0 for an AI Chat message (offsets are per message). */
  offset: number;
  messageId?: string;
}

export interface ExtractionSource {
  item: TreeItem;
  turns: SourceTurn[];
  /** False when no turn structure was found: the writer's turns can't be told from the model's. */
  hasTurns: boolean;
}

/** The turns of a chat, AI Chat or document, or null while its text hasn't loaded. */
export function extractionSource(item: TreeItem, body: string | undefined, chat: ChatTranscript | undefined): ExtractionSource | null {
  if (item.type === AI_CHAT_TYPE) {
    if (!chat) return null;
    const turns = chat.messages.filter(m => m.text.trim()).map((m, i): SourceTurn => ({
      index: i + 1,
      role: m.role === 'user' ? 'user' : 'model',
      label: m.role === 'user' ? 'You' : m.model || 'AI',
      text: m.text,
      offset: 0,
      messageId: m.id,
    }));
    return { item, turns, hasTurns: turns.length > 0 };
  }
  if (body === undefined) return null;
  const spans = turnSpans(body) ?? exporterTurnSpans(body);
  if (spans?.length) {
    const turns = spans.filter(s => s.end > s.start).map((s, i): SourceTurn => ({
      index: i + 1, role: s.role, label: s.label, text: body.slice(s.start, s.end), offset: s.start,
    }));
    return { item, turns, hasTurns: true };
  }
  return { item, turns: body.trim() ? [{ index: 1, role: 'unknown', label: 'Text', text: body, offset: 0 }] : [], hasTurns: false };
}

const turnText = (t: SourceTurn) => `[Turn ${t.index} · ${t.label}]\n${t.text}`;

/** The source text as sent: each turn under a numbered label. */
export const sourceTextFor = (turns: readonly SourceTurn[]): string => turns.map(turnText).join('\n\n');

/** Longest quote matched loosely (whitespace-tolerant); longer ones must match exactly. */
const LOOSE_QUOTE_LIMIT = 2_000;

/** Finds `quote` in `text`: exactly, else with any run of whitespace matching any other. */
function find(text: string, quote: string): { start: number; end: number } | null {
  const exact = text.indexOf(quote);
  if (exact >= 0) return { start: exact, end: exact + quote.length };
  const words = quote.trim().split(/\s+/).filter(Boolean);
  if (!words.length || quote.length > LOOSE_QUOTE_LIMIT) return null;
  const pattern = words.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s+');
  const m = new RegExp(pattern).exec(text);
  return m ? { start: m.index, end: m.index + m[0].length } : null;
}

/**
 * Where a quote the model returned sits: in the turn it cited, else in any other turn. The stored
 * quote is the source's own text at those offsets. Null when it can't be found (never made up).
 */
export function locateEvidence(src: ExtractionSource, quote: string, turn: number): { source: FactSource; turn: SourceTurn } | null {
  const cited = src.turns.find(t => t.index === turn);
  const order = cited ? [cited, ...src.turns.filter(t => t !== cited)] : src.turns;
  for (const t of order) {
    const hit = find(t.text, quote);
    if (!hit) continue;
    const source: FactSource = {
      itemId: src.item.id,
      ...(t.messageId !== undefined && { messageId: t.messageId }),
      quote: t.text.slice(hit.start, hit.end),
      start: t.offset + hit.start,
      end: t.offset + hit.end,
    };
    return { source, turn: t };
  }
  return null;
}

/**
 * Consecutive groups of whole turns whose text (as sent) fits in `maxChars`. A turn longer than that
 * gets a group of its own.
 */
export function chunkTurns(turns: readonly SourceTurn[], maxChars: number): SourceTurn[][] {
  const chunks: SourceTurn[][] = [];
  let current: SourceTurn[] = [];
  let size = 0;
  for (const t of turns) {
    const add = turnText(t).length + (current.length ? 2 : 0);
    if (current.length && size + add > maxChars) {
      chunks.push(current);
      current = [];
      size = 0;
    }
    size += current.length ? add : turnText(t).length;
    current.push(t);
  }
  if (current.length) chunks.push(current);
  return chunks;
}
