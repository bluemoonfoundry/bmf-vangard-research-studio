# Phase 5.3: AI Extraction to Proposals Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On demand, read chosen chats and documents with the configured AI and turn what they establish into proposed facts and proposed cards, each with evidence and an evidence strength, reviewed in a queue. Nothing becomes canon automatically, and rejections stay rejected.

**Architecture:** The main process gains one non-streaming channel, `llm:extract`. It sends a renderer-built prompt with a fixed, main-owned JSON schema through each provider's structured-output feature and returns structurally validated JSON. Everything else is pure renderer logic in a new `src/extraction/`: reading a source as numbered turns, chunking, prompt text, checking results against the stored text (quotes, strength), fingerprints, merging into the bible and review transitions. A `useExtraction` hook runs jobs (run cache, chunks, cancel). Review state, rejections and the cache live in a new `bible/extraction.json`, plumbed exactly like `bible/bible.json`.

**Tech Stack:** Electron (main process, ESM JS + JSDoc), React 19 + TypeScript, Vitest (`main` and `renderer` projects), Testing Library, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-18-ai-extraction-design.md` (Part 3). Beads: vrs-063.6.3. The semantic conflict check (`llm:conflict-check`) is **out of scope** here (vrs-063.6.4).

## Global Constraints

- AI is strictly opt-in. Every extraction surface (Extract button and dialog, review queue, "This is my own writing" toggle, strength labels' actions) stays hidden while `ai.enabled` is false. `llm:extract` and `llm:extract-cancel` refuse with `AI_DISABLED`. `extraction.json` itself still loads, saves and recovers with AI off (it's project data).
- Nothing becomes canon automatically: extraction only creates `proposed` facts (origin `"ai"`), pending cards and suggested items.
- The main process owns network and keys. The renderer builds the prompt text, and main sends it and validates the JSON. `MAX_REQUEST_CHARS` (4,000,000) applies.
- Provider wire formats (verified Oct 2026, recorded in each adapter's header comment):
  - Gemini: `POST /v1beta/models/{model}:generateContent`, `generationConfig: { responseMimeType: 'application/json', responseSchema }` (OpenAPI subset: upper-case `type`, `properties`, `required`, `items`, `enum`, `propertyOrdering`; no `additionalProperties`). The text is in `candidates[0].content.parts[].text` (skip `thought` parts). `promptFeedback.blockReason` means blocked.
  - Anthropic: `POST /v1/messages` (non-streaming), `output_config: { format: { type: 'json_schema', schema } }`, no beta header. Every object has `additionalProperties: false`, no numeric or length constraints. The text is in the `content[]` block with `type: 'text'`. `stop_reason` `refusal` or `max_tokens` means unusable.
  - OpenAI: `POST /v1/responses` (non-streaming, `store: false`), `text: { format: { type: 'json_schema', name: 'extraction', strict: true, schema } }`. Strict mode: every property required, `additionalProperties: false`. The text is in an `output[]` item with `type: 'message'`, in the content part with `type: 'output_text'`. A `refusal` part means refused.
- Offsets follow the bible's source rules: body offsets for `'chat'` and documents, per-message offsets plus `messageId` for `'ai-chat'`. A quote that can't be found is dropped, never stored with made-up offsets.
- Bridge changes update `src/vite-env.d.ts`, `src/test/fakeBridge.ts`, `src/ai/aiApi.ts` and the bridge-surface list in `e2e/smoke/app-launch.spec.ts`.
- Save order: docs, chats, `tree.json`, `bible/bible.json`, `bible/extraction.json`, `vrs.json`, then deletions.
- No `schemaVersion` bump: `evidence`, `ownWriting` and `extraction.json` are additive.
- Theme-token utilities only. `no-console`. Tests first. `npm run gate` passes before the issue closes.
- Commit after each task. Message endings carry `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Decisions (builder's calls, recorded in the spec in Task 9)

1. **Strength is verified, not trusted.** A proposal counts as `said` or `built_on` only when at least one of its located quotes sits in a writer turn. Otherwise it's `suggested`, whatever the model claimed. A source without turns has only model turns, unless it's marked `ownWriting`, in which case every turn is the writer's and every proposal is `said`. This one rule implements the "sources without turns" and "This is my own writing" requirements.
2. **Fact rejections are derived.** An AI fact (`origin: 'ai'`) with status `set_aside` that no decision's `setAsideIds` contains *is* an explicit rejection. So the fact's own "Set aside", in the queue or in the card or editor, needs no extra bookkeeping, and "Mark unreviewed" lifts it. `extraction.json` stores only the rejections that have no fact: rejected new cards, dismissed suggested items, and facts rejected inside a pending card.
3. **A fingerprint** is `<entity part>\u0000<attributeKey>\u0000<value key>`. The entity part is `id:<entityId>` for an existing entity and `card:<kind>:<normalizeText(title)>` for a proposed card. The value key is `normalizeText(value)`, or `S<season>E<episode|->#<order|->` for a position. A rejection matches an entity by either its `id:` part or its `card:<kind>:<title>` part, so a fact rejected on a pending card stays rejected after the card is approved under that name.
4. **`when` values** come back from the model as text `S<season>[E<episode>][#<order>]` (for example `S1E3#2`) and are parsed into a `StoryPosition`. An unparseable `when` value is dropped and counted as invalid.
5. **Turn reading.** For `'chat'` items, use `turnSpans(body)` (canonical layout). If that finds none, `exporterTurnSpans(body)` finds `### 👤 User` / `### 🤖 X` headings in place in a pre-Part-1 import, keeping offsets into the stored body. For `'ai-chat'`, each message is a turn (`user` → writer). For documents and turnless chats, the body is one model turn.
6. **Chunking**: the budget is `floor((inputTokenLimit ?? 100_000) * 0.5) * 4` characters for turns, after subtracting the canon section. Chunks are consecutive whole turns. A single turn larger than the budget is split at paragraph boundaries. Chunk N > 1 carries the previous chunk's `summary`.
7. **Canon section cap**: 60,000 characters. Above it, keep only entities whose title appears in the source text (case-insensitive).
8. **Run cache key**: `cyrb53` hash of the source text (as sent: turns joined) + `PROMPT_VERSION` + provider + model, one entry per source id. Cached proposals are re-applied (re-matched against current canon) on every run.
9. **"Keep the newer"** is a non-AI convenience (it only uses source order). It's offered on any open contradiction whose versions' newest evidence positions differ, and is never applied automatically.
10. **Review queue** is a workspace mode, "Review" (AI only), grouped by card: pending new cards first, then entities with proposed AI facts, then the collapsible "Only suggested" pile.

## Review Focus

1. **The model invents or paraphrases a quote**: that evidence is dropped, and a proposal left with no evidence is dropped and counted. Nothing is stored with guessed offsets. Pinned in Task 6.
2. **The model claims `said` for something only the model wrote**: it lands in "Only suggested", not in the bible. Pinned in Task 6.
3. **Re-running after rejecting, or a branched chat repeating the same detail**: a rejected fingerprint never comes back, and an agreeing value adds evidence to the existing fact instead of a new fact. Pinned in Task 6.
4. **AI turned off mid-run, or the project closed**: the run ends as cancelled, sources finished before that keep their results, and no request is sent after the cancel. Pinned in Tasks 2 and 7.
5. **A project with no `bible/extraction.json`, or one saved by this phase opened with AI disabled**: it opens fine, extraction data is kept untouched on save, and no extraction UI shows. Pinned in Tasks 4 and 8.

---

## File Structure

| File | Responsibility |
|---|---|
| `electron/lib/llm/extractSchema.js` (new) | The extraction JSON schema, per-provider schema forms, structural validation of a reply |
| `electron/lib/llm/providers/{gemini,anthropic,openai}.js` | `generateJson(request, schema, key, signal)` |
| `electron/lib/llm/llmService.js` | `extract`, `cancelExtract`; abortAll/abortEpoch cover them |
| `electron/main.js`, `electron/preload.js`, `src/vite-env.d.ts`, `src/ai/{aiApi,types}.ts`, `src/test/fakeBridge.ts` | Bridge |
| `e2e/fakeProvider.ts` | `:generateContent` route returning a configured JSON reply |
| `electron/lib/projectSchema.js`, `electron/lib/projectStore.js` | `evidence` validation; `bible/extraction.json` read/normalize/save |
| `src/project/{types,projectState,useProject}.ts` | `Extraction` slice, `updateExtraction`, watcher path |
| `src/bible/evidence.ts` (new) | `factSources`, `addEvidence`, `newerVersionIndex` |
| `src/bible/cards.ts`, `src/components/bible/{VersionCard,ConflictQueue,EntityCard,FactRow}.tsx` | Counts from evidence; "Keep the newer"; strength label |
| `src/extraction/types.ts` (new) | Extraction state and proposal types |
| `src/extraction/sourceTurns.ts` (new) | Read a source as turns; chunking; hash |
| `src/extraction/prompt.ts` (new) | `PROMPT_VERSION`, system text, canon context, request building |
| `src/extraction/results.ts` (new) | Validate a reply against the source: quotes, strength, positions |
| `src/extraction/apply.ts` (new) | Fingerprints, rejections, merging into bible + extraction, review transitions |
| `src/extraction/useExtraction.ts` (new) | Runs jobs: cache, chunks, progress, cancel |
| `src/components/extraction/{ExtractModal,ReviewQueue}.tsx` (new) | Dialog and queue |
| `src/components/workspace/{Workspace,Inspector,DocumentEditor}.tsx`, `src/components/chat/ChatHeader.tsx` | Wiring, `ownWriting` toggle, "Extract facts" from a chat |
| `e2e/ai/extraction.spec.ts` (new) | End-to-end flow against the fake provider |

---

### Task 1: Structured JSON per provider

**Files:**
- Create: `electron/lib/llm/extractSchema.js`, `electron/lib/llm/extractSchema.test.ts`
- Modify: `electron/lib/llm/providers/{gemini,anthropic,openai}.js` and their `*.test.ts`

**Interfaces:**
- Produces:
  ```js
  // extractSchema.js
  export const STRENGTHS = ['said', 'built_on', 'suggested'];
  export const EXTRACTION_SCHEMA;            // JSON Schema (draft subset), every object additionalProperties:false, all properties required
  export function geminiSchema(schema): object;   // OpenAPI-subset conversion (upper-case types, propertyOrdering, drops additionalProperties)
  /** @returns {{ proposals: RawProposal[], summary: string, invalid: number }} */
  export function validateExtraction(value: unknown);  // throws LlmError('PROVIDER', 'The provider returned an unusable answer.') if not an object with a proposals array
  // RawProposal = { entityId: string, newCardKind: string, newCardTitle: string, newCardReason: string,
  //   attribute: string, value: string, strength: 'said'|'built_on'|'suggested', replaces: string,
  //   evidence: { turn: integer, quote: string }[] }   ("" means none for the string fields)
  // Adapter method:
  generateJson(request: { model, system, messages: {role,text}[], temperature? }, schema: object, key, signal)
    => Promise<{ text: string, model: string, usage?: { inputTokens?, outputTokens? } }>
  ```
  `validateExtraction` drops (and counts in `invalid`) a proposal missing a non-empty `attribute`/`value`, with an unknown `strength`, with no evidence, or with neither `entityId` nor `newCardKind`+`newCardTitle`. Evidence items need an integer `turn` ≥ 1 and a non-empty `quote`. Strings are trimmed. A missing `summary` becomes `''`.

- [ ] **Step 1: Write failing tests**: `extractSchema.test.ts` (`validateExtraction` keeps a well-formed proposal, drops each malformed kind and counts it, throws on `{}` and on a non-object; `geminiSchema(EXTRACTION_SCHEMA)` has no `additionalProperties` anywhere, has `type: 'OBJECT'` at the root and `propertyOrdering` equal to the `properties` keys). Per adapter, `generateJson`: the request URL, headers and body shape listed in Global Constraints (assert `body.generationConfig.responseMimeType === 'application/json'`, `body.output_config.format.type === 'json_schema'`, `body.text.format.strict === true`, `body.stream` absent/false, `store: false` for OpenAI); returns the text; thought parts skipped (Gemini); `blockReason` → `BAD_REQUEST`; Anthropic `stop_reason: 'refusal'` → `PROVIDER` "The model declined to answer."; `max_tokens` → `PROVIDER` "The answer was cut off. Try a smaller source or another model."; OpenAI refusal part → `PROVIDER` "The model declined to answer."; an aborted signal → `CANCELLED`; a key never appears in a thrown message.
- [ ] **Step 2: Run** `npx vitest run --project main electron/lib/llm` (expect FAIL: missing exports).
- [ ] **Step 3: Implement.** Use `requestJson`. Anthropic `max_tokens: 16000`. Gemini and OpenAI set no output cap. Temperature follows the same capability rules as `stream`. Extend each header comment with the verified structured-output rules.
- [ ] **Step 4: Run** the same command (expect PASS).
- [ ] **Step 5: Commit** `feat(ai): structured JSON output per provider`.

### Task 2: `llm:extract` channel and bridge

**Files:**
- Modify: `electron/lib/llm/llmService.js` (+test), `electron/main.js`, `electron/preload.js`, `src/vite-env.d.ts`, `src/ai/types.ts`, `src/ai/aiApi.ts` (+test), `src/test/fakeBridge.ts`, `e2e/smoke/app-launch.spec.ts`, `e2e/fakeProvider.ts`

**Interfaces:**
- Consumes: Task 1 `generateJson`, `EXTRACTION_SCHEMA`, `validateExtraction`, `geminiSchema`.
- Produces:
  ```ts
  // src/ai/types.ts
  export interface ExtractRequest { provider: ProviderId; model: string; system: string; text: string; temperature?: number }
  export interface RawProposal { entityId: string; newCardKind: string; newCardTitle: string; newCardReason: string;
    attribute: string; value: string; strength: 'said' | 'built_on' | 'suggested'; replaces: string; evidence: { turn: number; quote: string }[] }
  export interface ExtractResult { proposals: RawProposal[]; summary: string; invalid: number; model: string; usage?: { inputTokens?: number; outputTokens?: number } }
  // bridge (window.vrs.ai) and AiApi (unwrapped)
  extract(requestId: string, request: ExtractRequest): Promise<VrsIpcResult<ExtractResult>>;
  cancelExtract(requestId: string): Promise<VrsIpcResult<void>>;
  ```
  Service: `extract(requestId, raw)` checks `requireEnabled`, `isValidItemId(requestId)`, the request shape (`text` non-empty, total chars ≤ `MAX_REQUEST_CHARS`, else INVALID "The source is too long to send."), the key, a duplicate id, and the `abortEpoch` captured at entry (→ `CANCELLED`). It registers an `AbortController` in a separate `jobs` map, calls `generateJson` (Gemini gets `geminiSchema(...)`), `JSON.parse`s the text (failure → PROVIDER "The provider returned an unusable answer."), and returns `validateExtraction` + `model` + `usage`. Errors are scrubbed. `cancelExtract(id)` (requires enabled) aborts that job. `abortAll()` also aborts every job. A job aborted mid-request rejects with `CANCELLED`.
  Fake provider: `POST /v1beta/models/{model}:generateContent` records into `extracts: StreamRequest[]` and replies `{ candidates: [{ content: { parts: [{ text: <setExtractReply JSON> }] }, finishReason: 'STOP' }], modelVersion }`. It honours `hold()` and `release()`. `setExtractReply(value: unknown)` sets the reply, defaulting to `{ proposals: [], summary: '' }`.

- [ ] **Step 1: Failing tests** in `llmService.test.ts`: refused with `AI_DISABLED` while off (both channels); invalid id → INVALID; oversize → INVALID; a successful call returns validated proposals and passes `geminiSchema` for gemini and the raw schema for others; unparseable text → PROVIDER; `abortAll()` during a pending call → the promise rejects `CANCELLED`; `abortAll()` while the key lookup is awaited → `CANCELLED`, and the adapter is never called; `cancelExtract` aborts only its own job. In `aiApi.test.ts`, `extract`/`cancelExtract` unwrap.
- [ ] **Step 2: Run** `npx vitest run electron/lib/llm/llmService.test.ts src/ai` (expect FAIL).
- [ ] **Step 3: Implement** the service and IPC (`handle('llm:extract', (id, r) => llm.extract(id, r))`, `handle('llm:extract-cancel', (id) => llm.cancelExtract(id))`), preload, types, fake bridge (`fake.ai.extractReplies: ExtractResult[]` queue and `fake.ai.extractCalls`), bridge-surface list (`'cancelExtract', 'extract'` added in sorted order), fake provider route.
- [ ] **Step 4: Run** `npx vitest run` (expect PASS) and `npm run typecheck`.
- [ ] **Step 5: Commit** `feat(ai): llm:extract channel with cancel`.

### Task 3: Evidence on facts, counts and "Keep the newer"

**Files:**
- Create: `src/bible/evidence.ts`, `src/bible/evidence.test.ts`
- Modify: `src/project/types.ts`, `electron/lib/projectSchema.js` (+test), `src/bible/cards.ts` (+test), `src/components/bible/{VersionCard,ConflictQueue,EntityCard,FactRow}.tsx` (+ConflictQueue/EntityCard tests)

**Interfaces:**
- Produces:
  ```ts
  export type EvidenceStrength = 'said' | 'built_on' | 'suggested';
  export interface Evidence { source: FactSource; strength: EvidenceStrength }
  // Fact gains: evidence?: Evidence[]
  // src/bible/evidence.ts
  export function factSources(f: Fact): FactSource[];   // source first, then evidence sources not equal to it (same itemId+messageId+start+end)
  export function addEvidence(b: Bible, factId: string, evidence: Evidence[], now: string): Bible; // dedupes by itemId+messageId+start+end; returns b when nothing new
  export function strengthOf(f: Fact): EvidenceStrength | null;  // strongest of evidence (said > built_on > suggested), null without evidence
  export function newerVersionIndex(c: Contradiction, b: Bible, items: readonly TreeItem[]): number | null;
  ```
  `newerVersionIndex`: each version's rank = max position in `orderedSources(b, items)` over its facts' `factSources` (−1 when none listed). It returns the index of the unique maximum, or null when it's tied, or when every rank is −1. `projectSchema.checkFact` validates `evidence` (optional array; each `{ source: <same rules as source>, strength ∈ STRENGTHS }`). `sourceCount` and `cameFrom` in `cards.ts` use `factSources`. VersionCard gains an optional `suggested?: boolean`, which shows a "Keep the newer" primary button, with `onKeep`, in place of "Keep this one" plus a "newer source" note. FactRow shows the strength label (`said` → "you said it", `built_on` → "you built on it", `suggested` → "only suggested") when `strengthOf(fact)` isn't null.

- [ ] **Step 1: Failing tests**: `factSources` dedupe; `addEvidence` idempotent; `strengthOf` ordering; `newerVersionIndex` (newer source wins; tie → null; unlisted sources count oldest); `cards.test.ts` (a fact with one source plus evidence from a second item counts 2 sources, and `cameFrom` lists both); `projectSchema.test.ts` (rejects an evidence item with a bad strength or bad source, accepts a valid one); ConflictQueue (a "Keep the newer" button keeps the version from the later source).
- [ ] **Step 2: Run** `npx vitest run src/bible src/components/bible electron/lib/projectSchema.test.ts` (expect FAIL).
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** again (expect PASS).
- [ ] **Step 5: Commit** `feat(bible): fact evidence lists, source counts from evidence, Keep the newer`.

### Task 4: `bible/extraction.json` plumbing

**Files:**
- Create: `src/extraction/types.ts`
- Modify: `electron/lib/projectSchema.js` (+test), `electron/lib/projectStore.js` (+test), `src/project/{types,projectState,useProject}.ts` (+tests)

**Interfaces:**
- Produces:
  ```ts
  // src/extraction/types.ts
  export interface ProposalEntity { id?: string; kind: string; title: string; reason?: string }   // raw names kept so cached results re-match
  export interface Proposal {
    entity: ProposalEntity; attribute: string; value: string | StoryPosition;
    strength: EvidenceStrength; evidence: FactSource[]; replaces?: string;
  }
  export interface CacheEntry { hash: string; at: string; proposals: Proposal[] }
  export interface PendingCard { id: string; kind: string; title: string; reason: string; proposals: Proposal[] }
  export interface SuggestedItem { id: string; proposal: Proposal }
  export interface Rejection { key: string; label: string; at: string }
  export interface Extraction { rejections: Rejection[]; cache: Record<string, CacheEntry>; pendingCards: PendingCard[]; suggested: SuggestedItem[] }
  export const emptyExtraction = (): Extraction => ({ rejections: [], cache: {}, pendingCards: [], suggested: [] });
  ```
  `OpenedProject` and `readStructure` results gain `extraction: Extraction`. `SavePayload` and `RecoverySnapshot` gain `extraction?: Extraction`. Main: `EXTRACTION_FILE = 'bible/extraction.json'`, and `normalizeExtraction(raw)` (undefined → empty; non-object, a non-array list or a non-object cache → `CORRUPT` "extraction.json ..."; unknown fields kept). Written right after `bible.json`. Reducer: `extraction`/`savedExtraction` like the bible, an `extractionUpdated` action, `saved`/`recoveryRestored`/`structureReloaded`/`structureKeptMine` handling, `isStructureDirty` includes it, and `buildSavePayload` includes it when changed, after `pruneExtraction(e, items)` (in `src/extraction/types.ts`) drops cache entries of deleted sources and returns `e` itself when nothing is pruned. Pending cards and suggested items are kept: they carry entity names and re-match on the next apply. `useProject` exposes `updateExtraction(update: (e: Extraction) => Extraction)` and treats `bible/extraction.json` like `bible/bible.json` in the external-change handler.

- [ ] **Step 1: Failing tests**: projectStore (opening a project without the file gives an empty extraction; save writes it after bible.json in `onWrite` order; a corrupt file → `CORRUPT`); projectSchema (`validateSavePayload` normalizes `extraction`); projectState (`extractionUpdated` makes the project dirty, a save marks it clean, `buildSavePayload` drops cache entries of deleted sources, `recoveryRestored` adopts the snapshot's extraction); useProject (an external change to `bible/extraction.json` reloads the structure).
- [ ] **Step 2: Run** `npx vitest run electron/lib/projectStore.test.ts electron/lib/projectSchema.test.ts src/project` (expect FAIL).
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** again (expect PASS); `npm run typecheck`.
- [ ] **Step 5: Commit** `feat(extraction): bible/extraction.json load, save, recovery and watch`.

### Task 5: Reading sources and building requests

**Files:**
- Create: `src/extraction/sourceTurns.ts` (+test), `src/extraction/prompt.ts` (+test)
- Modify: `src/chat/importFormats.ts` (+test): `exporterTurnSpans`

**Interfaces:**
- Produces:
  ```ts
  // importFormats.ts
  export function exporterTurnSpans(body: string): TurnSpan[] | null;  // AI Chat Exporter headings found in place; footer and the stray 'Model' line excluded from spans
  // sourceTurns.ts
  export interface SourceTurn { n: number; role: TurnRole; text: string; offset: number; messageId?: string }  // offset: where `text` starts in the stored body (0 for ai-chat: offsets are into the message)
  export interface SourceDoc { itemId: string; title: string; hasTurns: boolean; turns: SourceTurn[] }
  export function readSource(item: TreeItem, body: string | undefined, chat: ChatTranscript | undefined): SourceDoc | null; // null when not loaded or empty
  export function chunkTurns(turns: SourceTurn[], budgetChars: number): SourceTurn[][];
  export function turnBudget(inputTokenLimit: number | undefined, canonChars: number): number;  // max(4_000, floor((limit ?? 100_000) * 0.5) * 4 - canonChars)
  export function hashText(s: string): string;   // cyrb53, hex
  export function sourceHash(doc: SourceDoc, provider: string, model: string): string;
  // prompt.ts
  export const PROMPT_VERSION = 'extract-v1';
  export const CANON_CAP_CHARS = 60_000;
  export function canonContext(items: TreeItem[], bible: Bible, extraction: Extraction, sourceText: string): string;
  export function buildExtractRequest(args: { provider: ProviderId; model: string; doc: SourceDoc; chunk: SourceTurn[]; chunkIndex: number; chunkCount: number;
    canon: string; summary: string; ownWriting: boolean }): ExtractRequest;
  ```
  The turn text format sent to the model is `[Turn <n> · <You|Model>]\n<text>` per turn. `ownWriting` labels every turn `You`, and a turnless source labels its single turn `Model`. `canonContext` lists each entity as `- id=<id> · <Kind> · <Title>` followed by `    <attribute>: <value> (kept|proposed)` lines for live facts and `    <attribute>: <value> (rejected)` for derived and stored rejections, then the attributes in use per kind (`attributeSuggestions`). The system prompt (fixed text in `prompt.ts`) must instruct the model to: reuse existing entity ids, attribute names and value wordings verbatim when they mean the same thing; condense each fact to a short value; quote evidence verbatim from the numbered turns; judge `built_on` from the writer's *later* turns (use counts, not only explicit acceptance); propose only the latest version when the writer changed their mind within the source and put the earlier value in `replaces`; never propose a rejected value; propose new cards only for named things with at least one fact; write `when` as `S<season>[E<episode>][#<order>]`; and return a running `summary` (entities and adopted facts so far, under 300 words).

- [ ] **Step 1: Failing tests**: `exporterTurnSpans` on the existing fixture `src/chat/fixtures/aistudio-exporter-sample.md` (roles and labels; `body.slice(start, end)` equals the turn text with no `Model` residue); `readSource` for a canonical chat, a raw-exporter chat (offsets into the stored body), an ai-chat (messageIds, `offset` 0), a document (one model turn), and an unloaded body (null); `chunkTurns` keeps whole turns, splits an oversize turn at a blank line with correct offsets, and never returns an empty chunk; `hashText` is stable and differs on a one-character change; `canonContext` caps at `CANON_CAP_CHARS` by keeping only mentioned entities; `buildExtractRequest` labels turns as specified and includes the summary only for chunk > 1.
- [ ] **Step 2: Run** `npx vitest run src/extraction src/chat/importFormats.test.ts` (expect FAIL).
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** again (expect PASS).
- [ ] **Step 5: Commit** `feat(extraction): read sources as turns, chunk, build requests`.

### Task 6: Checking results and merging them into the bible

**Files:**
- Create: `src/extraction/results.ts` (+test), `src/extraction/apply.ts` (+test)

**Interfaces:**
- Consumes: Task 3 `addEvidence`; Task 4 types; Task 5 `SourceDoc`.
- Produces:
  ```ts
  // results.ts
  export function parsePosition(s: string): StoryPosition | null;     // 'S1', 'S1E3', 'S1E3#2', case-insensitive, spaces allowed
  export interface CheckedResult { proposals: Proposal[]; dropped: number }
  export function checkResult(raw: RawProposal[], doc: SourceDoc, items: TreeItem[], ownWriting: boolean): CheckedResult;
  // apply.ts
  export const fingerprint: (entityPart: string, attribute: string, value: Fact['value']) => string;
  export function entityParts(e: ProposalEntity | TreeItem): string[];   // ['id:<id>'] and/or ['card:<kind>:<title>']
  export function rejectedKeys(b: Bible, e: Extraction, items: TreeItem[]): Set<string>;  // stored + derived (Decision 2)
  export interface ApplyIds { newId(): string; now: string }
  export interface ApplySummary { added: number; merged: number; suggested: number; cards: number; skipped: number }
  export function applyProposals(b: Bible, e: Extraction, items: TreeItem[], proposals: Proposal[], ids: ApplyIds): { bible: Bible; extraction: Extraction; summary: ApplySummary };
  export function approveCard(b: Bible, e: Extraction, items: TreeItem[], cardId: string, entityId: string, ids: ApplyIds): { bible: Bible; extraction: Extraction };  // caller has added the entity item
  export function rejectCard(e: Extraction, cardId: string, now: string): Extraction;
  export function rejectCardFact(e: Extraction, cardId: string, index: number, now: string): Extraction;
  export function promoteSuggested(b: Bible, e: Extraction, items: TreeItem[], suggestedId: string, ids: ApplyIds): { bible: Bible; extraction: Extraction };
  export function dismissSuggested(e: Extraction, suggestedId: string, now: string): Extraction;
  export function liftRejection(e: Extraction, key: string): Extraction;
  export function rejectionsFor(b: Bible, e: Extraction, entity: TreeItem): { key: string; label: string; factId?: string }[];
  ```
  `checkResult`: entity resolution order: a `entityId` that names an existing entity; else an entity whose kind (when given) and `normalizeText(title)` match `newCardTitle`; else a new card (`kind` must be a known `ENTITY_KINDS` id, else dropped). Each evidence quote is located with `locateQuote` inside its turn's text, falling back to a search across every turn. Turn offsets turn it into a `FactSource` (`messageId` for ai-chat). Unlocated quotes are dropped, and a proposal with none left is dropped. Strength follows Decision 1. `when` values go through `parsePosition`, and a failure drops the proposal.
  `applyProposals`, per proposal, in order: skip if any of its fingerprints is in `rejectedKeys`. `suggested` merges into `e.suggested` (by fingerprint, merging evidence). A new-card entity merges into `e.pendingCards` (by kind + normalized title; proposals merged by fingerprint). Otherwise, if a live fact agrees on the same entity and attribute (`groupVersions` rule), `addEvidence`, else `addFact` with `{ status: 'proposed', origin: 'ai', source: evidence[0], evidence: evidence.map(source => ({ source, strength })), note?: replaces ? 'Replaces "<replaces>"' : undefined }`. A proposal whose entity now exists (a cached card that was approved) attaches to it.

- [ ] **Step 1: Failing tests** (Review Focus 1–3): an invented quote is dropped; a proposal with only invented quotes is dropped and counted; `said` with only model-turn evidence becomes `suggested`; built_on with a later writer-turn quote stays `built_on`; a document proposal is `suggested`, and the same with `ownWriting` is `said`; ten agreeing mentions in one run give one fact with ten evidence entries; a second run over an identical source adds no evidence (dedupe); a rejected fingerprint (derived, from a set-aside AI fact) is skipped on re-run, but a fact set aside by `keepOne` is not treated as rejected and comes back as a new proposed fact; a new-card proposal goes to `pendingCards`, and `approveCard` turns its said/built_on proposals into proposed facts on the new entity and its suggested ones into `e.suggested`; `rejectCard` makes later proposals for that card skip; `rejectCardFact` before approval still blocks that fact after approval; `promoteSuggested` adds a proposed fact and `dismissSuggested` records a rejection; `liftRejection` removes it; `parsePosition` table.
- [ ] **Step 2: Run** `npx vitest run src/extraction` (expect FAIL).
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** again (expect PASS).
- [ ] **Step 5: Commit** `feat(extraction): check results against the source and merge into proposals`.

### Task 7: Running extraction jobs

**Files:**
- Create: `src/extraction/useExtraction.ts` (+test)

**Interfaces:**
- Consumes: Tasks 2, 5, 6.
- Produces:
  ```ts
  export interface ExtractionPlan { sources: { item: TreeItem; doc: SourceDoc; cached: boolean; requests: number; tokens: number }[]; tokens: number; requests: number }
  export interface RunProgress { done: number; total: number; current: string | null; summary: ApplySummary; dropped: number; errors: { title: string; message: string }[]; finished: boolean; cancelled: boolean }
  export function planExtraction(args: { items: TreeItem[]; ids: string[]; bodyOf; chatOf; bible; extraction; provider; model; inputTokenLimit?: number }): ExtractionPlan;
  export function useExtraction(args: { ai: AiApi | null; project: Pick<ProjectController, 'state' | 'updateBible' | 'updateExtraction'> }): {
    progress: RunProgress | null; start(ids: string[], provider: ProviderId, model: string, inputTokenLimit?: number): Promise<void>; cancel(): void; clear(): void;
  };
  ```
  Sources run one at a time, chunks one at a time. `ownWriting` is read from the item. A fresh `requestId` (`crypto.randomUUID()`) goes to each call. A cache hit (same `sourceHash`) makes no request. After each source, its proposals are written to `e.cache[itemId]` and applied through `updateBible`/`updateExtraction`, reading the latest state from a ref. `cancel()` calls `cancelExtract` on the in-flight id and stops before the next request. `ai` turning null (AI disabled) cancels. An error on one source is recorded and the run moves on. A `CANCELLED` error ends the run.

- [ ] **Step 1: Failing tests** (`renderHook` with `createFakeBridge`): a two-source run calls `extract` twice and applies both; a second run with unchanged sources makes no calls; changing the model invalidates the cache; a source needing two chunks sends the first summary in the second request; `cancel()` mid-run keeps the first source's results and makes no further calls; an error on source 1 still runs source 2 and is listed.
- [ ] **Step 2: Run** `npx vitest run src/extraction/useExtraction.test.ts` (expect FAIL).
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** again (expect PASS).
- [ ] **Step 5: Commit** `feat(extraction): run extraction jobs with cache and cancel`.

### Task 8: Extract dialog, review queue and toggles

**Files:**
- Create: `src/components/extraction/ExtractModal.tsx` (+test), `src/components/extraction/ReviewQueue.tsx` (+test)
- Modify: `src/components/workspace/{Workspace,Inspector,DocumentEditor}.tsx` (+Workspace test), `src/components/chat/ChatHeader.tsx`, `src/components/bible/EntityCard.tsx`

**Interfaces:**
- Consumes: Tasks 3–7.
- Produces (UI contract, used by the e2e test):
  - Toolbar button "Extract" and mode button "Review" (with a count of pending cards + proposed AI facts + suggested), shown only when `ai.enabled`.
  - `ExtractModal` (`role="dialog"`, title "Extract facts"): a checklist of source items in source order (`aria-label` = item title), a per-row "This is my own writing" checkbox, a model `<select aria-label="Model">` (configured providers' models, defaulting to Settings), the estimate line `"<n> sources · ~<tokens> tokens · <requests> requests (<cached> cached)"`, buttons "Start" / "Cancel run" / "Close", progress `"<done> of <total>"` and the final summary `"<added> new · <merged> merged · <suggested> only suggested · <cards> new cards"`.
  - `ReviewQueue` (`aria-label="Review queue"`): sections "New cards" (each: title, kind, reason, its facts with quotes; a folder `<select aria-label="Folder for <title>">` defaulting to the folder of the first entity of that kind, "Approve card", "Reject card", per-fact "Reject"), one section per entity (`aria-label` = its title) with proposed AI facts (quote, strength label, "Keep", "Set aside", "Show conflict" when in an open contradiction), and a `<details>` "Only suggested (<n>)" with "Promote" / "Dismiss" per item.
  - Inspector: "This is my own writing" checkbox for chat, ai-chat and document items when AI is on (`ownWriting: true`, removed when unchecked).
  - Chat toolbar (DocumentEditor for `chat` items, ChatHeader for `ai-chat`): "Extract facts" opens `ExtractModal` with that item preselected. AI only.
  - EntityCard: a "Rejected" `<details>` listing `rejectionsFor(...)`. "Lift" calls `liftRejection` for stored ones and sets the fact back to `proposed` for derived ones.

- [ ] **Step 1: Failing tests**: Workspace (no Extract/Review buttons with AI off; both shown with AI on); ExtractModal (the estimate updates with the selection; Start calls `start` with the picked ids and model; "Cancel run" calls `cancel`); ReviewQueue (Approve creates an entity in the chosen folder and its facts become proposed; Reject card records a rejection; Keep/Set aside change status; Promote/Dismiss); Inspector (the toggle sets `ownWriting`, hidden with AI off); EntityCard (the Rejected list shows a set-aside AI fact, and Lift makes it proposed).
- [ ] **Step 2: Run** `npx vitest run src/components` (expect FAIL).
- [ ] **Step 3: Implement.** Approving a card: `addItem({ type: 'entity', entityKind, title, parentId })`, then `approveCard(...)` with the new id.
- [ ] **Step 4: Run** again (expect PASS); `npm run typecheck && npm run lint`.
- [ ] **Step 5: Commit** `feat(extraction): extract dialog, review queue, own-writing toggle`.

### Task 9: End-to-end test and docs

**Files:**
- Create: `e2e/ai/extraction.spec.ts`
- Modify: `CLAUDE.md` (Story Bible + AI Layer sections, save order), `docs/superpowers/specs/2026-10-18-ai-extraction-design.md` ("Part 3 implementation decisions": Decisions 1–10 above, one line each)

- [ ] **Step 1: Write the e2e** (`aiTest` fixture, AI enabled against the fake): import the exporter fixture, create the character "Mara", `setExtractReply` with one `built_on` proposal for Mara (a writer-turn quote from the fixture), one proposal with an invented quote, one `said` proposal backed only by a model-turn quote, and one new-card proposal. Run Extract and check the summary line. In Review: Mara's fact is proposed with "you built on it", "Only suggested (1)", and one new card. Approve the card. Set Mara's fact aside, run again (the cache means no new request: `fake.extracts.length` unchanged), and the fact is not re-proposed. Save, reopen, and the queue state survives. Turn AI off: the Extract and Review buttons are gone.
- [ ] **Step 2: Run** `npm run test:e2e -- e2e/ai/extraction.spec.ts` (expect PASS after fixing what fails).
- [ ] **Step 3: Docs.**
- [ ] **Step 4: Run** `npm run gate` (expect all green).
- [ ] **Step 5: Commit** `test(e2e): AI extraction flow; docs: Part 3 implementation decisions`.
