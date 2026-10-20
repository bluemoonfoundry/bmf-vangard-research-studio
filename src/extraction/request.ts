import type { ExtractRequest, ProviderId } from '@/ai/types';
import type { Bible, Fact, TreeItem } from '@/project/types';
import { ENTITY_KINDS, attributeSuggestions, entityKindOf } from '@/bible/entities';
import { attributeKey, formatValue, normalizeText } from '@/bible/normalize';
import type { ExtractionState } from '@/extraction/types';
import { rejectedFingerprints } from '@/extraction/apply';
import { sourceTextFor, type ExtractionSource, type SourceTurn } from '@/extraction/sourceText';

/**
 * The extraction prompt and request text. The prompt version is part of the run cache key, so bump
 * EXTRACTION_PROMPT_VERSION whenever EXTRACTION_SYSTEM or the request layout changes meaningfully.
 */

export const EXTRACTION_PROMPT_VERSION = 1;

/** Above this the canon keeps only entities the source mentions by name. */
export const CANON_CAP_CHARS = 40_000;

/** Assumed input limit when the model doesn't report one (the OpenAI adapter never does). */
const DEFAULT_INPUT_TOKENS = 100_000;
/** Share of the input limit the source text may use, leaving room for the reply and estimation error. */
const SOURCE_SHARE = 0.6;
const CHARS_PER_TOKEN = 4;
const MIN_SOURCE_CHARS = 4_000;

export const EXTRACTION_SYSTEM = [
  "You read a writer's worldbuilding source (usually a chat between the writer and an AI model) and extract",
  'condensed facts about their story for a story bible: characters, locations, factions, items, lore, events and plotlines.',
  '',
  'Each proposal names one entity, one attribute and one short condensed value, with evidence quotes and a strength:',
  '- said: the writer stated it in their own turn ("You").',
  '- built_on: the model offered it and a later turn by the writer used it or built on it. Look for later use, not',
  '  only explicit acceptance: the writer often just carries on with an idea. Include the later passage as evidence.',
  '- suggested: the model offered it and the writer never came back to it. Brainstormed options the writer did not',
  '  take up are suggested, never built_on.',
  '',
  'Rules:',
  '- Evidence quotes are copied exactly from a single turn, character for character, each with that turn\'s number',
  '  (the N in "[Turn N · ...]"). Keep quotes short: the passage that shows the fact.',
  '- Use an existing entity\'s id from the canon when the source is about it. For an entity not in the canon, use',
  "  id \"\" with its name and kind, and say in reason why it deserves a card. Use a proposed new card's exact name.",
  '- Reuse an existing attribute name and the exact wording of an existing value whenever you mean the same thing.',
  '- One proposal per entity, attribute and value: merge repeated mentions into one proposal with several quotes.',
  '- When the writer changed their mind within this source, propose only the latest version and put the earlier',
  '  value in replaces.',
  '- Never propose a value or a card the canon lists as rejected.',
  '- For a "when" attribute (events), write the value as "season N", optionally followed by ", episode N" and ", order N".',
  '- summary: a compact list of the entities and adopted facts established so far, for reading the next part.',
].join('\n');

/** FNV-1a (32-bit) with a seed. */
function fnv1a(text: string, seed: number): string {
  let h = seed >>> 0;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/** The run cache key: the source text as sent, the prompt version, provider and model. */
export function cacheKey(text: string, provider: ProviderId, model: string): string {
  const input = `${provider}\u0000${model}\u0000${text}`;
  return `v${EXTRACTION_PROMPT_VERSION}:${fnv1a(input, 0x811c9dc5)}${fnv1a(input, 0x9747b28c)}:${text.length}`;
}

const oneLine = (s: string): string => s.replace(/\s+/g, ' ').trim();
const valueText = (v: Fact['value']): string => (typeof v === 'string' ? oneLine(v) : formatValue(v));
const kindName = (kind: string | null | undefined): string => (kind && ENTITY_KINDS.some(k => k.id === kind) ? kind : 'other');

/** One canon block per entity: id, title, kind, then live values and rejected values per attribute. */
function entityBlock(entity: TreeItem, bible: Bible, rejected: Map<string, string[]>): string {
  const lines = [`- id: ${entity.id} · ${oneLine(entity.title) || 'Untitled'} (${kindName(entityKindOf(entity) ?? entity.entityKind)})`];
  const groups = new Map<string, Fact[]>();
  for (const f of bible.facts) {
    if (f.entityId !== entity.id || f.status === 'set_aside') continue;
    const key = attributeKey(f.attribute);
    groups.set(key, [...(groups.get(key) ?? []), f]);
  }
  for (const facts of groups.values()) {
    const seen = new Set<string>();
    const values = facts.flatMap(f => {
      const text = valueText(f.value);
      if (seen.has(normalizeText(text))) return [];
      seen.add(normalizeText(text));
      return [`${text} [${f.status}]`];
    });
    lines.push(`  - ${oneLine(facts[0].attribute)}: ${values.join('; ')}`);
  }
  for (const r of rejected.get(entity.id) ?? []) lines.push(`  - rejected: ${r}`);
  return lines.join('\n');
}

/**
 * What the model must know to attach facts to existing cards instead of inventing duplicates: the
 * entities, the attribute names in use per kind, live and rejected values, and pending and rejected
 * new cards. Over CANON_CAP_CHARS, only entities whose title appears in `sourceText` stay.
 */
export function extractionCanon(items: TreeItem[], bible: Bible, extraction: ExtractionState, sourceText: string): string {
  const entities = items.filter(i => i.type === 'entity');
  const rejected = new Map<string, string[]>();
  const rejectedCards: string[] = [];
  for (const fp of rejectedFingerprints(bible, extraction)) {
    const [entityKey, attr, value] = fp.split('\u0000');
    if (entityKey.startsWith('new:') && !attr) {
      const [, kind, title] = /^new:([^:]*):(.*)$/.exec(entityKey) ?? [];
      if (title) rejectedCards.push(`${title} (${kind})`);
      continue;
    }
    rejected.set(entityKey, [...(rejected.get(entityKey) ?? []), `${attr}: ${value}`]);
  }

  const build = (shown: TreeItem[]) => {
    const parts: string[] = [];
    if (shown.length) parts.push(['## Existing entities', ...shown.map(e => entityBlock(e, bible, rejected))].join('\n'));
    const attrs = ENTITY_KINDS.filter(k => entities.some(e => entityKindOf(e) === k.id)).flatMap(k => {
      const names = attributeSuggestions(bible, items, k.id);
      return names.length ? [`- ${k.id}: ${names.join(', ')}`] : [];
    });
    if (attrs.length) parts.push(['## Attribute names in use', ...attrs].join('\n'));
    if (extraction.cards.length) {
      parts.push(['## Proposed new cards (not approved yet; use these exact names)', ...extraction.cards.map(c => `- ${oneLine(c.title)} (${c.kind})`)].join('\n'));
    }
    if (rejectedCards.length) parts.push(['## Rejected cards (never propose these)', ...rejectedCards.map(c => `- ${c}`)].join('\n'));
    return parts.join('\n\n');
  };

  let canon = build(entities);
  if (canon.length > CANON_CAP_CHARS) {
    const text = normalizeText(sourceText);
    canon = build(entities.filter(e => normalizeText(e.title) && text.includes(normalizeText(e.title))));
    if (canon.length > CANON_CAP_CHARS) canon = canon.slice(0, CANON_CAP_CHARS);
  }
  return canon || '(Nothing is established yet.)';
}

/** Characters of source text one request may carry, after `fixedChars` of prompt and canon. */
export function sourceBudgetChars(inputTokenLimit: number | undefined, fixedChars: number): number {
  const total = Math.floor((inputTokenLimit ?? DEFAULT_INPUT_TOKENS) * SOURCE_SHARE * CHARS_PER_TOKEN);
  return Math.max(MIN_SOURCE_CHARS, total - fixedChars);
}

export interface ExtractRequestArgs {
  provider: ProviderId;
  model: string;
  canon: string;
  source: ExtractionSource;
  chunk: SourceTurn[];
  chunkIndex: number;
  chunkCount: number;
  /** What earlier chunks established; sent only when the source is chunked. */
  summary: string;
}

export function buildExtractRequest(a: ExtractRequestArgs): ExtractRequest {
  const title = oneLine(a.source.item.title) || 'Untitled';
  const part = a.chunkCount > 1 ? ` (part ${a.chunkIndex + 1} of ${a.chunkCount})` : '';
  const sections = [`# Canon\n\n${a.canon}`];
  if (a.chunkCount > 1 && a.chunkIndex > 0 && a.summary) sections.push(`# What earlier parts of this source established\n\n${a.summary}`);
  sections.push(`# Source: "${title}"${part}\n\n${sourceTextFor(a.chunk)}`);
  return { provider: a.provider, model: a.model, system: EXTRACTION_SYSTEM, text: sections.join('\n\n') };
}
