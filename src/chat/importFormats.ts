import { normalizeChatText } from '@/bible/entities';

/**
 * Imported chat transcripts. A recognised export is stored in one canonical layout, whatever its
 * source format, so its turns can be found again in the stored text (fact offsets point into it):
 *
 *   === You ===
 *
 *   <the writer's turn>
 *
 *   === Gemini ===
 *
 *   <the model's turn>
 *
 * `You` is always the writer; any other label is a model turn. Anything unrecognised is stored as
 * plain text with no turns.
 */

export type ImportedFormat = 'aistudio-exporter-md' | 'text';
export type TurnRole = 'user' | 'model';

export interface ParsedTurn { role: TurnRole; label: string; text: string }

export interface ParsedTranscript {
  format: ImportedFormat;
  /** The exporter's `# ` heading. */
  title?: string;
  /** The exporter's Source link, kept only when it points at AI Studio. */
  sourceUrl?: string;
  /** Empty for plain text. */
  turns: ParsedTurn[];
  /** What gets stored: the canonical layout, or the normalized input for plain text. */
  body: string;
  /** User-facing notes about what was skipped. */
  warnings: string[];
}

export const USER_LABEL = 'You';

const HEADING = /^=== (.+) ===$/;
const roleOf = (label: string): TurnRole => (label === USER_LABEL ? 'user' : 'model');

/** Writes turns in the canonical layout. Text lines that would read as headings get a leading space. */
export function formatTurns(turns: ParsedTurn[]): string {
  return turns.map(t => {
    const text = t.text.split('\n').map(line => (HEADING.test(line) ? ` ${line}` : line)).join('\n');
    return `=== ${t.label} ===\n\n${text}\n`;
  }).join('\n');
}

export interface TurnSpan {
  role: TurnRole;
  label: string;
  headingStart: number;
  headingEnd: number;
  /** The turn text only: no heading, no separating blank lines. */
  start: number;
  end: number;
}

/** The turns of a stored body in the canonical layout, or null when it has none. */
export function turnSpans(body: string): TurnSpan[] | null {
  const headings: { label: string; start: number; end: number }[] = [];
  let pos = 0;
  for (const line of body.split('\n')) {
    const m = HEADING.exec(line);
    if (m) headings.push({ label: m[1], start: pos, end: pos + line.length });
    pos += line.length + 1;
  }
  if (!headings.length) return null;
  return headings.map((h, i) => {
    const limit = i + 1 < headings.length ? headings[i + 1].start : body.length;
    let start = h.end;
    while (start < limit && body[start] === '\n') start++;
    let end = limit;
    while (end > start && /\s/.test(body[end - 1])) end--;
    return { role: roleOf(h.label), label: h.label, headingStart: h.start, headingEnd: h.end, start, end };
  });
}

const CONVERSATION = '## 💬 Conversation';
const USER_HEADING = '### 👤 User';
const MODEL_HEADING = /^### 🤖 (.+)$/u;
const FOOTER = '*Exported by [AI Chat Exporter';
const SOURCE_ROW = /^\|\s*\*\*Source\*\*\s*\|\s*\[[^\]]*\]\(([^)\s]+)\)/;
const AI_STUDIO = 'https://aistudio.google.com/';

/**
 * The turns of raw AI Chat Exporter text, found in place. Chats imported before turns were parsed
 * hold the export as is; this lets extraction see their turns without rewriting the body (fact
 * offsets point into it). Spans hold what parseTranscript would keep as each turn's text. Null when
 * the text has no exporter conversation.
 */
export function exporterTurnSpans(body: string): TurnSpan[] | null {
  const lines = body.split('\n');
  const conv = lines.indexOf(CONVERSATION);
  if (conv < 0) return null;
  const starts: number[] = [];
  let pos = 0;
  for (const line of lines) {
    starts.push(pos);
    pos += line.length + 1;
  }
  const headings: { role: TurnRole; label: string; line: number }[] = [];
  let footer = lines.length;
  for (let i = conv + 1; i < lines.length; i++) {
    const model = MODEL_HEADING.exec(lines[i]);
    if (lines[i] === USER_HEADING || model) headings.push({ role: model ? 'model' : 'user', label: model ? model[1] : USER_LABEL, line: i });
    else if (lines[i].startsWith(FOOTER)) { footer = i; break; }
  }
  const spans: TurnSpan[] = [];
  headings.forEach((h, n) => {
    let first = h.line + 1;
    const limit = n + 1 < headings.length ? headings[n + 1].line : footer;
    while (first < limit && !lines[first].trim()) first++;
    if (h.role === 'model' && first < limit && lines[first] === 'Model') first++;
    while (first < limit && !lines[first].trim()) first++;
    let last = limit - 1;
    while (last >= first && !lines[last].trim()) last--;
    if (last >= first && lines[last] === '---') last--;
    while (last >= first && !lines[last].trim()) last--;
    if (last < first) return;
    const start = starts[first];
    let end = starts[last] + lines[last].length;
    while (end > start && /\s/.test(body[end - 1])) end--;
    spans.push({ role: h.role, label: h.label, headingStart: starts[h.line], headingEnd: starts[h.line] + lines[h.line].length, start, end });
  });
  return spans.length ? spans : null;
}

const plain = (body: string, warnings: string[] = []): ParsedTranscript => ({ format: 'text', turns: [], body, warnings });

function isDriveJson(text: string): boolean {
  if (!text.trimStart().startsWith('{')) return false;
  try {
    const v: unknown = JSON.parse(text);
    return typeof v === 'object' && v !== null && 'chunkedPrompt' in v;
  } catch {
    return false;
  }
}

/** Recognises an import's format and returns what to store. Never throws. */
export function parseTranscript(raw: string): ParsedTranscript {
  const text = normalizeChatText(raw);
  if (isDriveJson(text)) return plain(text, ["AI Studio Drive files aren't supported yet; imported as plain text."]);

  const lines = text.split('\n');
  const conv = lines.indexOf(CONVERSATION);
  if (conv < 0) return plain(text);

  const turns: { role: TurnRole; label: string; lines: string[] }[] = [];
  let current: (typeof turns)[number] | null = null;
  for (const line of lines.slice(conv + 1)) {
    const model = MODEL_HEADING.exec(line);
    if (line === USER_HEADING || model) {
      current = { role: model ? 'model' : 'user', label: model ? model[1] : USER_LABEL, lines: [] };
      turns.push(current);
    } else if (line.startsWith(FOOTER)) {
      break;
    } else {
      current?.lines.push(line);
    }
  }
  if (!turns.length) return plain(text);

  const parsed: ParsedTurn[] = [];
  let empty = 0;
  for (const t of turns) {
    const body = [...t.lines];
    const trimEnd = () => { while (body.length && !body[body.length - 1].trim()) body.pop(); };
    trimEnd();
    if (body[body.length - 1] === '---') body.pop();
    trimEnd();
    while (body.length && !body[0].trim()) body.shift();
    if (t.role === 'model' && body[0] === 'Model') body.shift();
    const turnText = body.join('\n').trim();
    if (turnText) parsed.push({ role: t.role, label: t.label, text: turnText });
    else empty++;
  }

  const result: ParsedTranscript = {
    format: 'aistudio-exporter-md',
    turns: parsed,
    body: formatTurns(parsed),
    warnings: empty ? [`${empty} empty turn${empty === 1 ? '' : 's'} skipped.`] : [],
  };
  if (lines[0].startsWith('# ')) result.title = lines[0].slice(2).trim();
  for (const line of lines.slice(0, conv)) {
    const m = SOURCE_ROW.exec(line);
    if (m && m[1].startsWith(AI_STUDIO)) result.sourceUrl = m[1];
  }
  return result;
}
