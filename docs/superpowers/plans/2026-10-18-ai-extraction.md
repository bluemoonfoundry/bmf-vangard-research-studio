# Phase 5.3: AI Extraction to Proposals Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On demand, read chosen transcripts and documents with the configured AI and turn what they establish into
`proposed` facts and proposed cards, each with evidence and a strength, reviewed in a queue. Nothing becomes canon
on its own, rejections stay rejected, and unchanged sources are never sent twice.

**Architecture:** The main process gets one new channel, `llm:extract`. It streams a normal provider request with
the provider's JSON-schema output turned on, collects the text, parses it and drops malformed items. Everything
else is pure renderer logic in a new `src/extraction/`: building the source text with turn markers, chunking,
cache keys, matching results against the current canon, fingerprints and rejections, evidence merging and
review transitions. Pending suggestions, pending new cards, stored rejections and the run cache live in a new
project file, `bible/extraction.json`, which is plumbed through the store exactly like `bible/bible.json`.

**Tech Stack:** Electron main (ESM JS + JSDoc), React 19 + TypeScript, Vitest (`main` + `renderer`), Testing
Library, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-18-ai-extraction-design.md` (Part 3). Beads: vrs-063.6.3. The semantic
conflict check (`llm:conflict-check`) is **out of scope** (vrs-063.6.4).

## Decisions this plan makes (the spec leaves them open)

- **Structured output rides the existing streaming calls** ("stream-then-collect"): a long non-streaming request
  can hit Node's 300 s headers timeout. Verified 2026-10-18 against the provider docs:
  - Gemini: `generationConfig.responseMimeType: 'application/json'` + `generationConfig.responseJsonSchema`
    (JSON Schema subset: type, properties, required, items, enum, description, additionalProperties, anyOf, min/maxItems).
  - Anthropic: `output_config: { format: { type: 'json_schema', schema } }`, no beta header; objects need
    `additionalProperties: false`. Supported on Claude 4.5+ models; older models fail with the provider's 400, which surfaces as is.
  - OpenAI Responses: `text: { format: { type: 'json_schema', name, schema, strict: true } }`; every property
    required, `additionalProperties: false`.
  - One schema serves all three: **every property required, no nulls, no type arrays**. "None" is `""` (entity id,
    `replaces`) or `0` (turn). The schema lives in the main process (`electron/lib/llm/extractionSchema.js`); the
    renderer never sends a schema.
- **`when` values** come back as text ("season 2, episode 3, order 1"). `parseWhen` turns that into a
  `StoryPosition`; an unparsable `when` is dropped and counted.
- **Rejections are partly derived.** A set-aside fact that no decision's `setAsideIds` lists *is* a rejection: the
  writer set it aside by hand. `keepOne`'s set-asides are listed in its decision, so they don't count, as the spec
  requires. `extraction.json` stores only rejections that have no fact: rejected new cards, dismissed suggestions,
  and dismissed proposals of pending cards. Lifting a derived rejection returns the fact to `proposed`.
- **Re-applying the same evidence never revives a decided value.** A proposal that matches a fact set aside by a
  decision is skipped when that fact already carries the same evidence. Only new evidence brings it back as a new
  `proposed` fact (which reopens the contradiction, per the spec).
- **Strength is checked against turns.** `said`/`built_on` need at least one located quote in a writer (`user`)
  turn; otherwise the proposal is downgraded to `suggested`. A source with no turns forces `suggested`, or `said`
  when `ownWriting` is set.
- **Quotes are located loosely but stored exactly.** Exact match inside the cited turn, then a whitespace-tolerant
  match inside the turn, then the same two over the whole text. The stored `quote` is the stored text at the found
  offsets, never the model's wording.
- **Old exporter imports keep their offsets.** A body with no canonical turn headings is scanned for the raw
  exporter headings (`### 👤 User` / `### 🤖 X`) in place (`exporterTurnSpans`), so the body is never rewritten.
- **Cache key** = FNV-1a hash of (source text as sent + `EXTRACTION_PROMPT_VERSION` + provider + model). Canon is not
  part of the key: cached raw results are re-matched against the current canon each time they're applied, so
  applying is idempotent (evidence and pending proposals dedupe).
- **Budget**: `inputTokenLimit ?? 100_000` tokens, of which 60% goes to source text after the system prompt and
  canon. The canon section is capped at 40,000 characters; over that, only entities whose title appears in the
  source are kept.
- **UI**: a toolbar "Extract" button (AI on only) opens `ExtractModal` with the active source preselected, and a
  "Review" workspace mode (AI on only, with a count badge) holds the queue. "Keep the newer" is non-AI and shows
  on any contradiction whose versions sit in different sources. Binder context-menu entry: not added; the dialog
  lists every source.

## Global Constraints

- AI is strictly opt-in: Extract, Review, ownWriting and the Rejected list are hidden while AI is off;
  `llm:extract` refuses with `AI_DISABLED`; `abortAll()` aborts extractions and bumps `abortEpoch`.
- Nothing auto-canon: extraction only creates `proposed` facts (origin `"ai"`) and pending cards/suggestions.
- Keys never reach the renderer; CSP unchanged; `MAX_REQUEST_CHARS` applies to `llm:extract`.
- Save order: docs, chats, `tree.json`, `bible/bible.json`, `bible/extraction.json`, `vrs.json`, then deletions.
- Additive schema only: `Fact.evidence?`, `Fact.replaces?`, `TreeItem.ownWriting?`, new file. No `schemaVersion` bump.
- Bridge changes update `src/vite-env.d.ts`, `src/test/fakeBridge.ts`, `src/ai/aiApi.ts` and the bridge-surface list in `e2e/smoke/app-launch.spec.ts`.
- Theme-token utilities only; `no-console`; tests first; `npm run gate` before closing.
- Commit after each task, ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **A model reply that isn't valid JSON or is cut off** (max tokens) must end the run for that source with a clear
   message, keep what earlier sources produced, and never write partial state. Pinned in Task 1 (`PROVIDER` "The AI's reply wasn't valid JSON") and Task 6.
2. **Re-running after decisions** (keep-one, set aside, reject card, dismiss) must propose nothing already decided
   and must not duplicate evidence. Pinned in Task 4 (idempotent apply, derived rejections, decided-evidence skip).
3. **A model quote that differs only in whitespace or line breaks** from the stored text must still land on the
   right offsets, and a paraphrased quote must be dropped. Pinned in Task 3.
4. **Turning AI off mid-run** must stop the run (`CANCELLED`) without applying the in-flight source's results.
   Pinned in Task 1 (abortAll/abortEpoch) and Task 6.
5. **Deleting a source or an entity after a run** must not break the queue: pending proposals for deleted entities
   are pruned on save, and evidence pointing at a deleted item resolves as a deleted source. Pinned in Task 2.

---

## File Structure

| File | Responsibility |
|---|---|
| `electron/lib/llm/extractionSchema.js` (new) | The response JSON schema, `parseExtraction(text)` validation |
| `electron/lib/llm/providers/{gemini,anthropic,openai}.js` | `request.jsonSchema` → provider structured-output fields |
| `electron/lib/llm/llmService.js` | `extract(requestId, request)`, `cancelExtract` |
| `electron/main.js`, `electron/preload.js`, `src/vite-env.d.ts`, `src/ai/{aiApi,types}.ts`, `src/test/fakeBridge.ts` | `llm:extract`, `llm:extract-cancel` bridge |
| `electron/lib/projectSchema.js`, `electron/lib/projectStore.js` | `bible/extraction.json` validation, open/save; `Fact.evidence` validation |
| `src/project/{types,projectState,useProject}.ts` | `extraction` state slice, `updateExtraction`, `updateCanon`, watcher path |
| `src/extraction/types.ts` (new) | Shapes of `extraction.json` and raw results |
| `src/extraction/sourceText.ts` (new) | Turns of a source, text sent, quote location, chunking, cache key |
| `src/extraction/request.ts` (new) | Prompt (versioned), canon section, request building |
| `src/extraction/apply.ts` (new) | Matching, fingerprints, rejections, evidence merge |
| `src/extraction/review.ts` (new) | Review-queue transitions and grouping |
| `src/bible/newer.ts` (new) | "Keep the newer" suggestion |
| `src/bible/cards.ts` | Counts use `evidence` when present |
| `src/extraction/useExtraction.ts` (new) | Run orchestration (cache, chunks, cancel, progress) |
| `src/components/extraction/{ExtractModal,ReviewQueue}.tsx` (new) | Dialog and queue |
| `src/components/bible/{FactRow,EntityCard,ConflictQueue}.tsx`, `src/components/workspace/{Workspace,Inspector}.tsx` | Evidence label, Rejected list, Keep the newer, entry points, ownWriting |
| `e2e/fakeProvider.ts`, `e2e/ai/extraction.spec.ts` (new) | End-to-end extraction |

---

### Task 1: `llm:extract` in the main process and the bridge

**Files:**
- Create: `electron/lib/llm/extractionSchema.js`, `electron/lib/llm/extractionSchema.test.ts`
- Modify: the three adapters + tests, `llmService.js` + test, `main.js`, `preload.js`, `src/vite-env.d.ts`, `src/ai/types.ts`, `src/ai/aiApi.ts` + test, `src/test/fakeBridge.ts`, `e2e/smoke/app-launch.spec.ts`

**Interfaces:**
- Produces (renderer types in `src/ai/types.ts`):
  ```ts
  export type Strength = 'said' | 'built_on' | 'suggested';
  export interface RawEvidence { quote: string; turn: number }            // turn 1-based; 0 = unknown
  export interface RawProposal {
    entity: { id: string; name: string; kind: string; reason: string };   // id '' = new card proposal
    attribute: string; value: string; strength: Strength;
    evidence: RawEvidence[]; replaces: string;                             // '' = none
  }
  export interface ExtractRequest { provider: ProviderId; model: string; system: string; text: string }
  export interface ExtractResult { proposals: RawProposal[]; summary: string; dropped: number; model: string;
    usage?: { inputTokens?: number; outputTokens?: number } }
  // VrsApi['ai']: extract(requestId, request): Promise<IpcResult<ExtractResult>>; cancelExtract(requestId): Promise<IpcResult<void>>
  ```
- `extractionSchema.js`: `EXTRACTION_SCHEMA` (object), `ENTITY_KIND_IDS`, `parseExtraction(text: string): { proposals, summary, dropped }` (throws `LlmError('PROVIDER', "The AI's reply wasn't valid JSON. Try again, or try a smaller source.")`).
- Adapters: `request.jsonSchema?: object` and `request.maxOutputTokens?: number` (Anthropic only; extraction passes 32000).

- [ ] **Step 1: Write failing tests**
  - `extractionSchema.test.ts`: `parseExtraction` keeps a valid proposal unchanged; drops (and counts) an item with
    an unknown strength, an unknown kind, an empty attribute/value, no evidence, an evidence quote that is empty, or a
    non-integer/negative turn; trims attribute/value; a missing `summary` reads as `''`; non-JSON or a non-object
    throws `PROVIDER`; tolerates a ```` ```json ```` fence around the JSON.
  - Adapter tests (one each): with `jsonSchema` set, Gemini's body has `generationConfig.responseMimeType === 'application/json'`
    and `generationConfig.responseJsonSchema === schema` (temperature still merged in); Anthropic's has
    `output_config.format = { type: 'json_schema', schema }` and `max_tokens === request.maxOutputTokens`; OpenAI's has
    `text.format = { type: 'json_schema', name: 'extraction', schema, strict: true }`. Without it the bodies are unchanged.
  - `llmService.test.ts` `describe('extract')`: refuses `AI_DISABLED` while off; rejects an invalid request id, unknown
    provider, empty text, and text over `MAX_REQUEST_CHARS` (`INVALID`); streams with `messages: [{ role: 'user', text }]`,
    `webSearch: false`, `readUrls: false`, the schema and `maxOutputTokens: 32000`, and resolves with the parsed result + `model`/`usage`
    from `done`; `cancelExtract(id)` rejects the pending call with `CANCELLED`; `abortAll()` does too; an `abortAll()` while
    the call awaits settings rejects `CANCELLED` and never calls the adapter; an `error` event rejects with its code; no
    chat event is emitted for extraction ids.
  - `aiApi.test.ts`: `extract` and `cancelExtract` unwrap.

- [ ] **Step 2: Run** `npx vitest run electron/lib/llm src/ai` → FAIL (missing exports/fields).

- [ ] **Step 3: Implement.** Adapters add the fields in `buildBody` and list them in their header comment's rule list.
  `extract` shares `active`/`abortOne`; an extract entry carries `onAbort` that rejects instead of emitting, so
  `abortOne` calls `entry.onAbort?.() ?? emit(...)`. `main.js`: `handle('llm:extract', ...)`, `handle('llm:extract-cancel', ...)`.
  Preload: `extract`, `cancelExtract`. fakeBridge: records `fake.ai.extractions` and resolves with `fake.ai.extractResult`
  (a settable value or function).

- [ ] **Step 4: Run** `npx vitest run electron/lib/llm src/ai` → PASS; `npm run typecheck` → clean.

- [ ] **Step 5: Commit** `feat(ai): llm:extract with structured output for Gemini, Claude and OpenAI`

---

### Task 2: `bible/extraction.json` and fact evidence storage

**Files:**
- Create: `src/extraction/types.ts`
- Modify: `electron/lib/projectSchema.js` + test, `electron/lib/projectStore.js` + test, `src/project/{types,projectState,useProject}.ts` + tests

**Interfaces:**
- Produces (`src/project/types.ts`):
  ```ts
  export interface Evidence { source: FactSource; strength: Strength }
  // Fact gains: evidence?: Evidence[]; replaces?: string
  // TreeItem gains: ownWriting?: boolean
  // OpenedProject gains extraction: ExtractionState; SavePayload gains extraction?: ExtractionState
  ```
- `src/extraction/types.ts`:
  ```ts
  export type EntityRef = { entityId: string } | { cardId: string };
  export interface PendingProposal {
    id: string; ref: EntityRef; attribute: string; value: string | StoryPosition;
    strength: Strength; evidence: Evidence[]; replaces?: string; createdAt: string;
  }
  export interface PendingCard { id: string; kind: EntityKind; title: string; reason: string; createdAt: string }
  export interface StoredRejection { fingerprint: string; label: string; at: string }   // label e.g. "Mara · eyes: green"
  export interface CachedRun { itemId: string; key: string; provider: ProviderId; model: string; at: string;
    proposals: RawProposal[]; dropped: number }
  export interface ExtractionState { rejections: StoredRejection[]; runs: CachedRun[]; cards: PendingCard[]; pending: PendingProposal[] }
  export const emptyExtraction = (): ExtractionState => ({ rejections: [], runs: [], cards: [], pending: [] });
  ```
- `projectSchema.js`: `EXTRACTION_FILE = 'bible/extraction.json'`, `normalizeExtraction(raw)` (missing → empty;
  four arrays required to be arrays of objects; ids valid; unknown fields kept), `checkFact` validates optional
  `evidence` (array of `{ source: <valid source>, strength: string }`).
- `projectState.ts`: `extraction` / `savedExtraction`; actions `{ type: 'extractionUpdated'; update }` and
  `{ type: 'canonUpdated'; update: (c: { bible: Bible; extraction: ExtractionState }) => { bible; extraction } }`;
  `structureReloaded` carries `extraction`; `buildSavePayload` sends `pruneExtraction(extraction, items)` when changed.
  `pruneExtraction` (in `src/extraction/review.ts`, Task 5, but the save needs it now: create it here) drops pending
  proposals whose `entityId` no longer exists and runs of deleted items.
- `useProject`: exposes `updateExtraction`, `updateCanon`; `bible/extraction.json` joins the watched structure paths.

- [ ] **Step 1: Failing tests**
  - `projectSchema.test.ts`: `normalizeExtraction(undefined)` → empty; keeps unknown fields; throws `CORRUPT` for a
    non-array `pending` or a pending entry with an invalid id; `normalizeBible` accepts a fact with valid `evidence`
    and rejects `evidence: [{ source: { itemId: '../x' } }]`; `validateSavePayload` accepts `extraction`.
  - `projectStore.test.ts`: open reads `bible/extraction.json` (missing → empty); save writes it after
    `bible/bible.json` and before `vrs.json` (assert `onWrite` order); `readStructure` returns it.
  - `projectState.test.ts`: `extractionUpdated` makes the project dirty and `saved` cleans it; `canonUpdated`
    changes both slices in one action; deleting an entity then building the payload prunes its pending proposals;
    recovery restore adopts `snapshot.extraction`; `structureKeptMine` marks it unsaved.
- [ ] **Step 2: Run** `npx vitest run electron/lib/projectSchema.test.ts electron/lib/projectStore.test.ts src/project` → FAIL.
- [ ] **Step 3: Implement** following the `bible` slice everywhere it appears (open, save, readStructure, reducer, payload, recovery, watcher list in `useProject.ts:381`).
- [ ] **Step 4: Run** the same tests → PASS; `npm test` → all green.
- [ ] **Step 5: Commit** `feat(extraction): bible/extraction.json and fact evidence storage`

---

### Task 3: Source text, quote location, chunking and the cache key

**Files:**
- Create: `src/extraction/sourceText.ts` + test
- Modify: `src/chat/importFormats.ts` + test (`exporterTurnSpans`)

**Interfaces:**
- Produces:
  ```ts
  // importFormats.ts
  export function exporterTurnSpans(body: string): TurnSpan[] | null;   // raw '### 👤 User' / '### 🤖 X' headings, in place
  // sourceText.ts
  export interface SourceTurn { index: number; role: 'user' | 'model' | 'unknown'; label: string;
    text: string; offset: number; messageId?: string }    // offset into the body (0 for AI Chat messages)
  export interface ExtractionSource { item: TreeItem; turns: SourceTurn[]; hasTurns: boolean }
  export function extractionSource(item: TreeItem, body: string | undefined, chat: ChatTranscript | undefined): ExtractionSource | null;
  export function sourceTextFor(turns: SourceTurn[]): string;          // "[Turn N · Label]\n<text>" blocks joined by "\n\n"
  export function locateEvidence(src: ExtractionSource, quote: string, turn: number): { source: FactSource; turn: SourceTurn } | null;
  export function chunkTurns(turns: SourceTurn[], maxChars: number): SourceTurn[][];
  export function cacheKey(text: string, provider: ProviderId, model: string): string;   // includes EXTRACTION_PROMPT_VERSION
  ```
- [ ] **Step 1: Failing tests**
  - `exporterTurnSpans` on a raw exporter body returns user/model spans whose `body.slice(start, end)` is the turn text,
    with the `Model` residue line and `---` separators outside the span; returns null for plain text.
  - `extractionSource`: a canonical chat gives roles from labels; an old raw-exporter chat gives turns via
    `exporterTurnSpans` and offsets into the unchanged body; a document with no headings gives one `unknown` turn
    and `hasTurns: false`; an AI Chat gives one turn per message with `messageId` and `offset: 0`; an unloaded body → null.
  - `locateEvidence`: exact quote in the cited turn → body offsets (`body.slice(start, end) === quote`); a quote with
    "\n" where the body has "\n\n  " still lands, and the stored `quote` is the body's text; a quote in a different turn
    than cited is found by the whole-text fallback; a paraphrase → null; AI Chat evidence carries `messageId` and
    message offsets.
  - `chunkTurns`: everything fits → one chunk; otherwise consecutive chunks under `maxChars`, never splitting a turn;
    a single oversized turn is its own chunk.
  - `cacheKey` is stable for equal inputs and differs when the text, provider or model changes.
- [ ] **Step 2: Run** `npx vitest run src/extraction/sourceText.test.ts src/chat/importFormats.test.ts` → FAIL.
- [ ] **Step 3: Implement.** Whitespace-tolerant match: escape the quote, replace whitespace runs with `\s+`, search
  with a `RegExp` (cap the quote at 2,000 chars). Hash: FNV-1a 32-bit run twice with different seeds, hex-joined.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(extraction): source turns, loose quote location, chunking, cache key`

---

### Task 4: Prompt, canon section and applying results

**Files:**
- Create: `src/extraction/request.ts` + test, `src/extraction/apply.ts` + test

**Interfaces:**
- `request.ts`:
  ```ts
  export const EXTRACTION_PROMPT_VERSION = 1;
  export const CANON_CAP_CHARS = 40_000;
  export function extractionCanon(items: TreeItem[], bible: Bible, extraction: ExtractionState, sourceText: string): string;
  export function buildExtractRequest(args: { provider: ProviderId; model: string; canon: string; source: ExtractionSource;
    chunk: SourceTurn[]; chunkIndex: number; chunkCount: number; summary: string }): ExtractRequest;
  export function sourceBudgetChars(inputTokenLimit: number | undefined, fixedChars: number): number; // ((limit ?? 100_000) * 0.6) * 4 - fixedChars, min 4_000
  ```
  The system prompt says: extract condensed facts per entity; `said` / `built_on` / `suggested` as in the spec, looking
  for later *use* by the writer, not only acceptance; reuse existing entity ids, attribute names and value wording
  exactly when meaning the same; only the latest version when the writer changed their mind in this source, with the
  earlier one in `replaces`; quotes copied verbatim from one turn, each tagged with its turn number; `when` as
  "season N[, episode N][, order N]"; never propose anything listed as rejected. Canon lists every entity
  (`id`, title, kind), attribute names per kind (`attributeSuggestions`), live and rejected values per attribute.
- `apply.ts`:
  ```ts
  export interface ApplyContext { items: TreeItem[]; bible: Bible; extraction: ExtractionState; source: ExtractionSource; now: string; newId(): string }
  export interface ApplySummary { facts: number; merged: number; suggested: number; cards: number; skipped: number; dropped: number }
  export function applyResults(ctx: ApplyContext, proposals: RawProposal[]): { bible: Bible; extraction: ExtractionState; summary: ApplySummary };
  export function fingerprint(entityKey: string, attribute: string, value: string | StoryPosition): string;
  export const entityKeyOf = (ref: { entityId: string } | { kind: string; title: string }) => string;  // id, or `new:<kind>:<normalized title>`
  export function rejectedFingerprints(bible: Bible, extraction: ExtractionState): Set<string>;
  export function parseWhen(text: string): StoryPosition | null;
  ```
- [ ] **Step 1: Failing tests** (`apply.test.ts` unless noted)
  - `request.test.ts`: the canon lists entity ids, kinds, attribute names, live (kept and proposed) values and rejected
    values; over `CANON_CAP_CHARS` only entities named in the source text remain; the request text holds
    `sourceTextFor(chunk)`, the summary only when `chunkCount > 1`, and "part 2 of 3"; `sourceBudgetChars(undefined, 0) === 240_000`.
  - Matching: `entity.id` of an existing entity → that entity; an unknown id with a title matching an entity
    (case/whitespace-insensitive) → that entity; no match → a new `PendingCard` (kind, title, reason) and the proposal
    pending on it; a second proposal for the same new title joins the same card; a cached card title that now matches
    an entity attaches to the entity.
  - Placement: `said` on an existing entity → a `proposed` fact (origin `ai`, `source` = first evidence, `evidence` with
    strength, `replaces` kept when non-empty); `suggested` → `extraction.pending`, not the bible.
  - Strength rules: `said` with evidence only in model turns → pending as `suggested`; a no-turn source → `suggested`;
    with `item.ownWriting` → `said`.
  - Merging: a proposal whose value normalizes equal to a live fact adds evidence to it (no new fact); the same
    evidence twice is not duplicated; applying the same proposals twice leaves state equal (deep) to applying once;
    pending proposals with equal fingerprints merge evidence.
  - Rejections: a fingerprint of a fact the writer set aside (no decision lists it) is skipped; a fact set aside by
    `keepOne` with the same evidence is skipped, but with new evidence comes back as a new `proposed` fact; a stored
    rejection skips the proposal; a rejected card fingerprint (`new:<kind>:<title>`, attribute `''`) skips the card and
    its proposals.
  - Drops: a quote that can't be located is dropped (and the proposal too when no evidence is left), counted in
    `dropped`; an unparsable `when` value is dropped; `parseWhen('Season 2, episode 3, order 1')` → `{ season: 2, episode: 3, order: 1 }`, `parseWhen('soon')` → null.
- [ ] **Step 2: Run** `npx vitest run src/extraction` → FAIL.
- [ ] **Step 3: Implement.** Agreement uses `groupVersions`' notion (`normalizeText` equal, or `positionsCompatible`). Evidence identity: `itemId`, `messageId`, `start`, `end`.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(extraction): prompt, canon section, matching, fingerprints and evidence merge`

---

### Task 5: Review transitions, Keep the newer, evidence-based counts

**Files:**
- Create: `src/extraction/review.ts` + test, `src/bible/newer.ts` + test
- Modify: `src/bible/cards.ts` + test

**Interfaces:**
- `review.ts` (all pure, `(state) => state` over `Canon = { bible: Bible; extraction: ExtractionState }`):
  ```ts
  export interface ReviewGroup { key: string; entity?: TreeItem; card?: PendingCard; facts: Fact[]; pending: PendingProposal[] }
  export function reviewGroups(items: TreeItem[], bible: Bible, extraction: ExtractionState): ReviewGroup[];   // AI-origin proposed facts + pending, by card; new cards last
  export function reviewCount(items: TreeItem[], bible: Bible, extraction: ExtractionState): number;
  export function approveCard(c: Canon, cardId: string, entityId: string, now: string, newId: () => string): Canon; // said/built_on → proposed facts; suggested stay pending on the entity; rejections keyed new:<kind>:<title> re-keyed to entityId
  export function rejectCard(c: Canon, cardId: string, now: string): Canon;     // stored rejection, card and its proposals removed
  export function promote(c: Canon, pendingId: string, now: string, newId: () => string): Canon;  // to a proposed fact (existing entity only)
  export function dismiss(c: Canon, pendingId: string, now: string): Canon;     // stored rejection
  export function rejectionsFor(entity: TreeItem, bible: Bible, extraction: ExtractionState): { fingerprint: string; label: string; factId?: string }[];
  export function liftRejection(c: Canon, fingerprint: string, now: string): Canon;  // stored → removed; derived → fact back to proposed
  export function pruneExtraction(x: ExtractionState, items: readonly TreeItem[]): ExtractionState;  // from Task 2
  ```
- `newer.ts`: `newerVersion(c: Contradiction, order: readonly string[]): number | null` (oldest-first ids; the version
  whose latest evidence item ranks furthest down; unlisted = oldest; null on a tie or when all evidence is from one item).
- `cards.ts`: `sourceCount` and `cameFrom` count `evidence[].source.itemId` when present, else `source.itemId`.
- [ ] **Step 1: Failing tests:** each transition above, with one assertion per comment's promise; `reviewGroups` puts an
  entity's AI proposed facts and pending suggestions in one group, ignores manual proposed facts, and lists new cards
  after entities; `newerVersion` picks the later source, null for a same-source pair and for a tie; `cardStats().sources`
  counts two evidence items from different chats as 2.
- [ ] **Step 2: Run** `npx vitest run src/extraction src/bible` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(extraction): review transitions, keep-the-newer suggestion, evidence counts`

---

### Task 6: Running an extraction (hook + dialog + entry points)

**Files:**
- Create: `src/extraction/useExtraction.ts` + test, `src/components/extraction/ExtractModal.tsx` + test
- Modify: `src/components/workspace/{Workspace,Inspector}.tsx` + tests

**Interfaces:**
- ```ts
  export interface RunSourceStatus { itemId: string; state: 'waiting' | 'cached' | 'running' | 'done' | 'error' | 'cancelled'; message?: string; summary?: ApplySummary }
  export interface ExtractionRun { running: boolean; statuses: RunSourceStatus[]; start(ids: string[], provider: ProviderId, model: ModelInfo): void; cancel(): void }
  export function useExtraction(args: { ai: AiApi | null; project: ProjectController }): ExtractionRun;
  ```
  Per source, in order: build the source; key it; a cached run with that key is applied without a request; otherwise
  each chunk is requested in turn (summary threaded), then the run is cached (`runs` keeps one per item) and applied
  through a single `updateCanon`. An error or cancel stops the run and applies nothing from that source. `cancel()`
  calls `cancelExtract` on the in-flight id. Turning AI off (`ai` becomes null) cancels.
- `ExtractModal` props: `{ items, sources: TreeItem[] (orderedSources), initialIds, aiStatus, models, loadModels, run, onSetOwnWriting(id, value), onReview(), onClose() }`.
  Shows source checkboxes (a no-turns source shows "No turns found: proposals will be 'suggested' unless this is your
  own writing" with an "This is my own writing" checkbox), provider/model selects (defaults from settings),
  the estimate ("3 sources · ~42,000 tokens · 1 cached · Gemini 2.5 Flash"), Start, per-source progress lines, Cancel, and
  at the end the totals and a "Review" button.
- Workspace: "Extract" toolbar button and "Review" mode button with `reviewCount` badge, both only when `aiEnabled`.
  Inspector: "This is my own writing" checkbox on chat/document items when a new `aiEnabled` prop is true.
- [ ] **Step 1: Failing tests**
  - `useExtraction.test.ts` (fake bridge): an uncached source sends one `extract` and applies a proposed fact; running
    it again sends nothing (status `cached`) and adds nothing; a two-chunk source sends two requests, the second
    containing the first's `summary`; an `extract` rejection leaves bible and extraction unchanged and sets `error`
    with the message; `cancel()` calls `cancelExtract` and stops before the next source.
  - `ExtractModal.test.tsx`: preselects `initialIds`; the estimate counts tokens and cached sources; ticking "own
    writing" calls `onSetOwnWriting`; Start calls `run.start` with the chosen ids and model.
  - `Workspace.test.tsx`: Extract and Review are absent with AI off and present with AI on.
- [ ] **Step 2: Run** `npx vitest run src/extraction src/components/extraction src/components/workspace` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(extraction): run extraction from the workspace with cache, chunks and cancel`

---

### Task 7: Review queue, evidence labels, Rejected list, Keep the newer

**Files:**
- Create: `src/components/extraction/ReviewQueue.tsx` + test
- Modify: `src/components/bible/{FactRow,EntityCard,ConflictQueue}.tsx` + tests, `Workspace.tsx`

**Interfaces:**
- `ReviewQueue` props: `{ items, bible, extraction, bodyOf, chatOf, updateCanon, addEntity(kind, title, parentId): string, onOpenSource, onOpenCard }`.
  Per group: header (entity title → opens card, or "New card · <kind>" with reason, a folder select defaulting to the
  folder of the first entity of that kind, Approve / Reject); proposed facts with quote, strength label and source
  count, Keep / Set aside; pending proposals of a new card listed under it. A collapsible "Only suggested (N)"
  section lists suggestions by card with Promote / Dismiss. Empty: "Nothing to review."
- `FactRow`: when `fact.evidence` is set, a label (`said` → "You said this", `built_on` → "Built on", `suggested` →
  "Suggested") from the strongest evidence, and "N sources" when more than one, and `replaces` as "Changed from: X".
- `EntityCard`: a "Rejected" side section (only with a new `aiEnabled` prop and rejections) listing `rejectionsFor`
  with Lift. `EntityCard` and `ConflictQueue`: a primary "Keep the newer" button when `newerVersion` is not null
  (both take a new `sourceOrder: string[]` prop from `orderedSources(...).map(i => i.id)`).
- [ ] **Step 1: Failing tests:** Approve creates the entity (via `addEntity`) and moves its facts into proposed; Reject
  removes the card; Promote/Dismiss move a suggestion; Set aside on an AI fact then re-applying the run proposes
  nothing (integration through `applyResults`); FactRow shows "Built on" and "2 sources"; Keep the newer keeps the
  version from the later source; Lift returns a set-aside fact to pending.
- [ ] **Step 2: Run** `npx vitest run src/components` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(extraction): review queue, evidence labels, rejected list, keep the newer`

---

### Task 8: End to end, docs, gate

**Files:**
- Create: `e2e/ai/extraction.spec.ts`
- Modify: `e2e/fakeProvider.ts` (`extractionReply(result): string[]` helper splitting JSON into chunks; records the request body so the spec can assert `responseJsonSchema`), `CLAUDE.md`, the spec (Part 3 implementation decisions)

- [ ] **Step 1: Write the e2e:** with AI on (aiTest fixture) import the sample transcript, open Extract, Start; the fake
  returns one `said` proposal for a new card and one `suggested`; Review shows the new card; Approve; the card wall shows
  the entity with "1 to review"; Keep makes it canon; re-running makes no new request (fake `streams` count unchanged).
  With AI off, the Extract and Review buttons are absent. The bridge-surface list includes `extract`, `cancelExtract`.
- [ ] **Step 2: Run** `npm run test:e2e -- e2e/ai/extraction.spec.ts` → PASS after any fixes.
- [ ] **Step 3: Docs:** CLAUDE.md gains an "AI extraction" section (llm:extract, extraction.json, derived rejections,
  cache key, save order) and the save-order lines; the spec gains "Part 3 implementation decisions" (this plan's
  decision list, condensed).
- [ ] **Step 4: Run** `npm run gate` → all green.
- [ ] **Step 5: Commit** `test(e2e): AI extraction flow; docs: Part 3 implementation decisions`
