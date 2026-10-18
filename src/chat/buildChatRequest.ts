import type { Capabilities, ChatRequest } from '@/ai/types';
import type { Bible, Fact, StoryPosition, TreeItem } from '@/project/types';
import { contradictionKey, findContradictions, groupVersions } from '@/bible/contradictions';
import { ENTITY_KINDS, entityKindOf } from '@/bible/entities';
import { attributeKey } from '@/bible/normalize';
import { AI_CHAT_TYPE } from '@/project/projectState';
import { transcriptPlainText } from '@/chat/transcript';
import type { ChatOf, ChatTranscript } from '@/chat/types';
import { itemTypeName } from '@/workspace/research';
import { childrenOf } from '@/workspace/treeOps';

/** Fixed framing between the chat's own system prompt and the project context (spec §6). */
export const VRS_PREAMBLE = [
  'You are working inside a story research workspace, helping a writer develop their story.',
  "The Canon section below lists the writer's established facts about their story: characters, places, events and lore, grouped by entity.",
  'Prefer the canon over guesses or outside assumptions, and do not contradict it unless the writer asks you to.',
  'When the canon is silent on something, say so plainly before offering an answer or suggestion of your own.',
  'Attached documents, when present, are the writer\'s research notes and drafts for this story.',
].join('\n');

/** A body text per item id (unsaved edits included), or undefined when not loaded. */
export type ContentOf = (id: string) => string | undefined;
/** The current transcript of an AI chat item, if loaded. */
export type { ChatOf };

const oneLine = (s: string): string => s.replace(/\s+/g, ' ').trim();
const titleOf = (i: TreeItem): string => oneLine(i.title) || 'Untitled';
/** Locale-independent, so the same input always gives the same prompt. */
const compareText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const byTitle = (a: TreeItem, b: TreeItem): number =>
  compareText(titleOf(a).toLowerCase(), titleOf(b).toLowerCase()) || compareText(a.id, b.id);

function positionText(p: StoryPosition): string {
  const parts = [`Season ${p.season}`];
  if (p.episode !== undefined) parts.push(`episode ${p.episode}`);
  if (p.order !== undefined) parts.push(`order ${p.order}`);
  return parts.join(', ');
}

const valueText = (v: Fact['value']): string => (typeof v === 'string' ? oneLine(v) : positionText(v));

function kindName(entity: TreeItem): string {
  const kind = entityKindOf(entity);
  return ENTITY_KINDS.find(k => k.id === kind)?.name ?? 'Entity';
}

/** Kept facts per entity (sorted by title, then attribute), with event order and unresolved conflicts. */
export function buildCanonText(items: TreeItem[], bible: Bible): string {
  const entities = items.filter(i => i.type === 'entity').sort(byTitle);
  const byId = new Map(items.map(i => [i.id, i]));
  const contradictions = new Map(findContradictions(bible, new Set(entities.map(e => e.id))).map(c => [c.key, c]));
  const blocks: string[] = [];

  for (const entity of entities) {
    const groups = new Map<string, Fact[]>();
    for (const f of bible.facts) {
      if (f.entityId !== entity.id || f.status !== 'kept') continue;
      const key = attributeKey(f.attribute);
      groups.set(key, [...(groups.get(key) ?? []), f]);
    }
    const lines: string[] = [];
    for (const key of [...groups.keys()].sort(compareText)) {
      const facts = groups.get(key) as Fact[];
      const label = oneLine(facts[0].attribute);
      const values = groupVersions(facts).map(v => valueText(v.value));
      if (values.length === 1) {
        lines.push(`- ${label}: ${values[0]}`);
        continue;
      }
      // Kept versions that disagree: open unless the writer chose to keep them all (as the dossier shows them).
      const acknowledged = contradictions.get(contradictionKey(entity.id, facts[0].attribute))?.acknowledgedBy;
      if (!acknowledged) {
        lines.push(`- ${label}: unresolved: ${values.join(' or ')}`);
        continue;
      }
      for (const v of values) lines.push(`- ${label}: ${v}`);
      const note = oneLine(acknowledged.note ?? '');
      lines.push(note ? `  (multiple versions kept: ${note})` : '  (multiple versions kept)');
    }
    const after = bible.dependencies
      .filter(d => d.eventId === entity.id && byId.has(d.afterEventId))
      .map(d => byId.get(d.afterEventId) as TreeItem)
      .sort(byTitle);
    for (const other of after) lines.push(`- comes after: ${titleOf(other)}`);

    if (lines.length) blocks.push([`### ${titleOf(entity)} (${kindName(entity)})`, ...lines].join('\n'));
  }
  return blocks.join('\n\n');
}

function bodyOf(item: TreeItem, contentOf: ContentOf, chatOf: ChatOf): string {
  if (item.type === 'image' || item.type === 'audio') return item.synopsis ?? '';
  if (item.type === AI_CHAT_TYPE) {
    const t = chatOf(item.id);
    return t ? transcriptPlainText(t) : '';
  }
  return contentOf(item.id) ?? '';
}

/**
 * The attached items as delimited blocks; folders mean every non-folder item under them, in binder order.
 * `selfId` (the chat being sent) is skipped, so a chat never quotes its own transcript.
 */
export function buildAttachmentsText(
  ids: string[], items: TreeItem[], contentOf: ContentOf, chatOf: ChatOf = () => undefined, selfId?: string,
): { text: string; missing: string[] } {
  const byId = new Map(items.map(i => [i.id, i]));
  const missing: string[] = [];
  const picked: TreeItem[] = [];
  const seen = new Set<string>();

  const visit = (item: TreeItem, path: Set<string>) => {
    if (item.type !== 'folder') {
      if (item.id !== selfId && !seen.has(item.id)) {
        seen.add(item.id);
        picked.push(item);
      }
      return;
    }
    if (path.has(item.id)) return; // a hand-edited tree with a cycle
    const inner = new Set(path).add(item.id);
    for (const child of childrenOf(items, item.id)) visit(child, inner);
  };

  for (const id of ids) {
    const item = byId.get(id);
    if (item) visit(item, new Set());
    else if (!missing.includes(id)) missing.push(id);
  }
  const text = picked
    .map(item => `### ${titleOf(item)} (${itemTypeName(item)})\n${bodyOf(item, contentOf, chatOf)}`)
    .join('\n\n');
  return { text, missing };
}

/** The system prompt: the chat's own prompt, the VRS preamble, then canon and attachments when present. */
export const systemText = (systemPrompt: string, canon: string, attachments: string): string => [
  systemPrompt.trim(),
  VRS_PREAMBLE,
  canon && `## Canon\n\n${canon}`,
  attachments && `## Attached documents\n\n${attachments}`,
].filter(Boolean).join('\n\n');

/** Messages sent as history: errored, streaming and empty assistant messages are skipped. */
export const historyOf = (messages: ChatTranscript['messages']): ChatRequest['messages'] => messages
  .filter(m => m.role === 'user'
    || (m.status !== 'error' && m.status !== 'streaming' && m.text.trim() !== ''))
  .map(m => ({ role: m.role, text: m.text }));

export interface BuildChatRequestArgs {
  transcript: ChatTranscript;
  /** Messages `[0, uptoIndex)` are sent as history. */
  uptoIndex: number;
  items: TreeItem[];
  bible: Bible;
  contentOf: ContentOf;
  /** Transcripts of attached AI chats. */
  chatOf?: ChatOf;
  /** The chat's own item id, left out of its attachments. */
  chatId?: string;
  caps: Capabilities;
}

/** The request for one send, built fresh from current in-memory state (spec §6). */
export function buildChatRequest({
  transcript, uptoIndex, items, bible, contentOf, chatOf, chatId, caps,
}: BuildChatRequestArgs): ChatRequest {
  const s = transcript.settings;
  if (!s.provider || !s.model) throw new Error('Pick a provider and model for this chat first.');

  const canon = buildCanonText(items, bible);
  const attachments = buildAttachmentsText(s.attachments, items, contentOf, chatOf, chatId).text;
  const system = systemText(s.systemPrompt, canon, attachments);
  const messages = historyOf(transcript.messages.slice(0, uptoIndex));

  const request: ChatRequest = {
    provider: s.provider,
    model: s.model,
    system,
    messages,
    webSearch: s.webSearch && caps.webSearch,
    readUrls: s.readUrls && caps.readUrls,
  };
  if (caps.temperature && typeof s.temperature === 'number') request.temperature = s.temperature;
  return request;
}

/** A rough token count for the context-size indicator: about four characters per token. */
export function estimateTokens(req: ChatRequest): number {
  const chars = req.system.length + req.messages.reduce((sum, m) => sum + m.text.length, 0);
  return Math.ceil(chars / 4);
}
