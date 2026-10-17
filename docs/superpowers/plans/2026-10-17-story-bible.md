# Story Bible Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a manual (no-AI) story bible to VRS. It has entities as binder items, facts with provenance,
deterministic contradiction detection with a side-by-side conflict queue, events on a browsable timeline,
read-only chat import with capture-by-selection, and a story-bible section in the Markdown export.

**Architecture:** The facts, dependencies and decisions live in one new project file, `bible/bible.json`
(schema v2). Validation happens in `electron/lib/projectSchema.js`, and it's read and written alongside
`tree.json`. Entities and chats are ordinary `TreeItem`s (`type: 'entity' | 'chat'`). All derived logic
(contradictions, decisions, ordering checks, timeline placement, source resolution) is pure TypeScript in
`src/bible/`, with unit tests. The renderer reducer holds `bible`/`savedBible` the same way it holds
`tree`/`savedTree`, and the React components in `src/components/bible/` only render and dispatch.

**Tech Stack:** Electron 44, React 19, TypeScript 6, Vitest 5 (projects `main` and `renderer`), Playwright
Electron e2e, Tailwind 4 theme tokens, lucide-react icons.

**Spec:** `docs/superpowers/specs/2026-10-17-story-bible-design.md`. Read it before any task. It is the
source of every behavior rule referenced below.

## Global Constraints

- **Repo and issue:** all work happens in `Y:/working/BlueMoonFoundry/bmf-vangard-research-studio`, on branch
  `feature/vrs-063.4-story-bible`. Commit locally, and **never push without asking the user**.
- **No AI code paths.** `origin` is written as `"manual"` only. No feature depends on AI settings.
- **No routes.** Use no route fields and no "canon/alternate" wording anywhere in the UI, types or file format.
- **Statuses:** exactly `proposed | kept | set_aside`. UI words: "Proposed", "Kept", "Set aside".
- **Decision kinds:** exactly `kept_one | kept_all`. UI actions: "Keep this one", "Keep both" (or "Keep all"
  when there are 3+ versions), "Reopen".
- **Entity kinds:** exactly `character, location, faction, item, lore, event, plotline`. Unknown kinds are
  shown generically and never dropped.
- **Text matching:** trim, collapse whitespace runs to one space, lower-case.
- **The `when` attribute** (matched by the same normalization) holds `{ season: int ≥ 1, episode?: int ≥ 1,
  order?: finite number }`. Every other attribute holds a string.
- **Manual facts** are created with status `kept`.
- **Save order:** docs → `tree.json` → `bible/bible.json` → `vrs.json` → deletions.
- **Imported or pasted chat text** is normalized to LF line endings, with any BOM removed, before it is stored.
- **Security rules from `CLAUDE.md`** apply: atomic writes, `resolveInside`/`validateProjectPath`, narrow
  preload functions, update `src/vite-env.d.ts` and the bridge-surface e2e test whenever the bridge
  changes, and sanitize any Markdown that's rendered.
- **Code style:** use the `@/` alias, theme-token classes (`bg-surface`, `text-content`, `text-content-muted`,
  `border-line`, `text-accent`), and the primitives in `src/components/workspace/ui.ts`. `no-console` is
  enforced. Write tests first.
- **Test commands:** unit tests run with `npx vitest run <path>` and the whole gate with `npm run gate`.

## Review Focus

1. **CRLF/BOM text:** a chat pasted or imported from a Windows `.txt` file contains `\r\n` and a BOM. The
   expected behavior is that offsets captured from the display match the stored body, so the source
   resolves `exact`. Pinned in Task 2 (`readTextImport`) and Task 7 (`normalizeChatText`).
2. **Hand-edited or corrupt `bible/bible.json`:** a bad status, a non-array `facts`, or a malformed `when`
   must fail with a clear `CORRUPT` message naming `bible.json`, and must never be partially loaded. A
   missing file means an empty bible. Pinned in Task 1.
3. **Deleting an event others depend on:** the dependencies that touch it are removed, and the timeline and
   ordering checks don't crash or show ghost ✗ marks. Pinned in Task 4 (`removeEntities`) and Task 5.
4. **An entity's kind changed from event to something else** while it still has `when` facts: it leaves the
   timeline, and its facts stay intact. Pinned in Task 5 (`buildTimeline`).
5. **Trivial variants:** "Death " vs "death", and "Season 3" vs "season  3", must corroborate, not
   contradict. Pinned in Task 3.

---

### Task 1: Bible file format, schema v2, open/save/readStructure

**Files:**
- Modify: `electron/lib/projectSchema.js`, `electron/lib/projectStore.js`
- Test: `electron/lib/projectSchema.test.ts`, `electron/lib/projectStore.test.ts`, `electron/lib/recoveryStore.test.ts`
- Also: `.gitignore` (add `.superpowers/`)

**Interfaces:**
- Produces, in `projectSchema.js`:
  - `CURRENT_SCHEMA_VERSION = 2`, and `MIGRATIONS[1] = (p) => p`.
  - `BIBLE_FILE = 'bible/bible.json'`.
  - `createEmptyBible() → { facts: [], dependencies: [], decisions: [] }`.
  - `normalizeBible(raw) → bible`, which throws `ProjectFormatError('CORRUPT', …)`.
  - `validateSavePayload` accepts `bible`, rethrowing failures as `INVALID`.
  - `normalizeText(s)`, the same rule as the TS `normalizeText` in Task 3.
- Produces, in `projectStore.js`:
  - `openProject` returns `{ manifest, tree, bible, migratedFrom }`.
  - `readStructure` returns `{ manifest, tree, bible }`.
  - `saveProject` writes `request.bible` in the save order above.

- [ ] **Step 0: Set up.** Create the branch `feature/vrs-063.4-story-bible`, add `.superpowers/` to
  `.gitignore`, then update the bead:
  `bd update vrs-063.4 --claim` and
  `bd update vrs-063.4 --description "<new text: per spec, routes dropped>"`.
  Finally, commit the spec and this plan:
  `docs(bible): story bible design and implementation plan (vrs-063.4)`.

- [ ] **Step 1: Write failing tests** in `projectSchema.test.ts`:
  - `normalizeBible(undefined)` deep-equals `createEmptyBible()`.
  - `normalizeBible({facts:'x'})` throws with code `CORRUPT` and a message containing `bible.json`.
  - A fact with `status:'canon'` throws `CORRUPT`.
  - A fact with `attribute:' When '` and `value:'S3'` throws. The same fact with `value:{season:3,episode:4}`
    passes. `value:{season:0}` throws.
  - A text fact with a non-string `value` throws. An invalid `id` or `entityId` (`'../x'`) throws.
  - A decision whose `kind` isn't `kept_one` or `kept_all` throws.
  - Unknown extra fields on facts are preserved.
  - `validateSavePayload({bible:{facts:'x'}})` throws `INVALID`.
  - `migrateProject` of a v1 project yields `schemaVersion 2` with `migratedFrom: 1`.
- [ ] **Step 2: Write failing tests** in `projectStore.test.ts`:
  - `openProject` on a v1 folder without `bible/bible.json` returns the empty bible.
  - `saveProject(root,{bible})` writes `bible/bible.json`. An `onWrite` spy records the order
    `docs/…`, `tree.json`, `bible/bible.json`, `vrs.json`.
  - `readStructure` returns the saved bible.
  - Corrupt `bible.json` on open rejects with `CORRUPT`.
- [ ] **Step 2b:** In `recoveryStore.test.ts`, assert that a snapshot with a `bible` round-trips through write
  and read.
- [ ] **Step 3: Run** `npx vitest run electron/lib`. The new tests should fail.
- [ ] **Step 4: Implement.**
  - `normalizeBible` validates each fact:
    - `id` and `entityId` pass `isValidItemId`, and `attribute` is a non-empty string.
    - `status` is in the status set.
    - `value` is a position when `normalizeText(attribute) === 'when'`, otherwise a string.
    - `source`, when present, has a valid `itemId`, a string `quote`, and integer `start ≤ end`.
  - It validates each dependency (`id`, `eventId`, `afterEventId` are all valid ids) and each decision (`id`,
    `entityId` valid ids, string `attribute`, a known `kind`, and `factIds`/`setAsideIds` as arrays of valid ids).
  - Unknown fields are preserved, the same as `normalizeTree`.
  - Store: read `BIBLE_FILE` with `readJsonFile(…, {optional:true})`. In `saveProject`, write the bible
    between the tree and the manifest.
- [ ] **Step 5: Run** `npx vitest run electron/lib`. Everything should pass.
- [ ] **Step 6: Commit:** `feat(bible): bible.json format and schema v2 (vrs-063.4)`.

### Task 2: Text import IPC for chat transcripts

**Files:**
- Create: `electron/lib/textImport.js`, `electron/lib/textImport.test.ts`
- Modify: `electron/main.js`, `electron/preload.js`, `src/vite-env.d.ts`, `src/project/api.ts`,
  `src/test/fakeBridge.ts`, `e2e/smoke/app-launch.spec.ts` (bridge surface list)

**Interfaces:**
- Produces:
  - `TEXT_IMPORT_EXTENSIONS = ['txt','md','markdown']` and `MAX_TEXT_IMPORT_BYTES = 5 * 1024 * 1024`.
  - `readTextImport(filePath) → Promise<{ title: string, text: string, fileName: string }>`. It throws
    `UNSUPPORTED` (bad extension) or `TOO_LARGE`.
  - IPC `project:import-text` (no args) opens a native dialog filtered to those extensions and resolves to the
    result, or `null` when cancelled.
  - Preload `project.importText()`; renderer `ProjectApi.importText(): Promise<TextImport | null>`.
  - `TextImport` type `{ title; text; fileName }` in `src/project/types.ts`.

- [ ] **Step 1: Write failing tests** in `textImport.test.ts`:
  - A `.txt` file containing `\uFEFFa\r\nb\r\n` returns `text === 'a\nb\n'`, `title === '<basename without ext>'`,
    and `fileName === '<basename>'`.
  - `.pdf` rejects with `UNSUPPORTED`.
  - A file over the limit rejects with `TOO_LARGE`. Stub the size check with a tiny injected limit:
    `readTextImport(p, { maxBytes: 4 })`.
- [ ] **Step 2: Run** `npx vitest run electron/lib/textImport.test.ts`. It should fail.
- [ ] **Step 3: Implement** `readTextImport(filePath, { maxBytes = MAX_TEXT_IMPORT_BYTES } = {})`. Check
  `fs.stat` before reading. Wire up the handler, preload, typings, `api.ts`, and a `fake.nextTextImport`
  in the fake bridge. Add `'importText'` to the expected bridge-surface list.
- [ ] **Step 4: Run** `npx vitest run electron/lib/textImport.test.ts` and `npm run typecheck`. Both should pass.
- [ ] **Step 5: Commit:** `feat(bible): import .txt/.md transcripts through the main process (vrs-063.4)`.

### Task 3: Bible types, normalization, contradiction detection

**Files:**
- Modify: `src/project/types.ts`
- Create: `src/bible/normalize.ts`, `src/bible/contradictions.ts`, `src/bible/bible.test.ts`
  (one test file for all of `src/bible/`, with a `describe` block per module)

**Interfaces:**
- Produces, in `src/project/types.ts`:
  ```ts
  export type EntityKind = 'character'|'location'|'faction'|'item'|'lore'|'event'|'plotline';
  export interface StoryPosition { season: number; episode?: number; order?: number }
  export type FactStatus = 'proposed'|'kept'|'set_aside';
  export interface FactSource { itemId: string; quote: string; start: number; end: number }
  export interface Fact { id: string; entityId: string; attribute: string; value: string | StoryPosition;
    status: FactStatus; source?: FactSource; origin: string; note?: string; createdAt: string; updatedAt: string;
    [extra: string]: unknown }
  export interface Dependency { id: string; eventId: string; afterEventId: string }
  export interface Decision { id: string; entityId: string; attribute: string; kind: 'kept_one'|'kept_all';
    factIds: string[]; setAsideIds: string[]; note?: string; at: string }
  export interface Bible { facts: Fact[]; dependencies: Dependency[]; decisions: Decision[] }
  ```
  - `TreeItem` gains `entityKind?: string` and `importedFrom?: string`. `ItemType` gains `'entity' | 'chat'`.
  - `OpenedProject` gains `bible: Bible`. `SavePayload` gains `bible?: Bible`. The `readStructure` result
    gains `bible`.
- Produces, in `normalize.ts`:
  - `normalizeText(s: string): string` and `attributeKey(attr: string): string`.
  - `WHEN = 'when'` and `isWhenAttribute(attr: string): boolean`.
  - `positionsCompatible(a: StoryPosition, b: StoryPosition): boolean`. True when every part present in both is equal.
  - `comparePositions(a, b): number`. Compares season, then episode, then order, with a missing part sorting first.
  - `specificity(p): 0|1|2`.
  - `formatPosition(p): string`. `{3}` → `"Season 3"`, `{3,4}` → `"S3 · E4"`, `{3,4,2}` → `"S3 · E4 · #2"`.
  - `emptyBible(): Bible`.
- Produces, in `contradictions.ts`:
  ```ts
  export interface Version { value: string | StoryPosition; facts: Fact[] }
  export interface Contradiction { key: string; entityId: string; attribute: string; versions: Version[];
    factIds: string[] /* sorted live ids */; acknowledgedBy: Decision | null }
  export function groupVersions(facts: Fact[]): Version[];
  export function findContradictions(bible: Bible, entityIds: ReadonlySet<string>): Contradiction[];
  export const openContradictions: (cs: Contradiction[]) => Contradiction[];
  export const contradictionKey: (entityId: string, attribute: string) => string; // `${entityId}\u0000${attributeKey(attribute)}`
  ```
  - **`groupVersions`, text values:** group by `normalizeText(value)`. The version's value is the first
    fact's raw value.
  - **`groupVersions`, positions:** sort facts by `specificity` descending (stable). Each fact joins the
    first version whose value it is `positionsCompatible` with, or else starts a new version. The version's
    value is its first, most specific, fact's value.

- [ ] **Step 1: Write failing tests:**
  - `normalizeText('  Season\t 3 ')` → `'season 3'`.
  - `positionsCompatible({season:3},{season:3,episode:4})` → true, and `({season:3,episode:4},{season:3,episode:5})` → false.
  - `comparePositions` orders `S3` < `S3E1` < `S3E1#2` < `S4`.
  - `groupVersions`:
    - `"Season 3"` and `"season  3"` → 1 version with 2 facts.
    - `{3}`, `{3,4}` → 1 version, valued `{3,4}`.
    - `{3,4}`, `{3,5}`, `{3}` → 2 versions.
  - `findContradictions`:
    - Facts on attributes `"Death "` and `"death"` with different values → 1 contradiction with 2 versions.
    - `set_aside` facts are ignored.
    - Facts whose `entityId` isn't in `entityIds` are ignored.
    - A `kept_all` decision whose sorted `factIds` equal the group's live ids sets `acknowledgedBy`. Adding a
      third differing fact clears it.
    - A proposed fact equal to the single kept value → no contradiction.
- [ ] **Step 2: Run** `npx vitest run src/bible`. It should fail.
- [ ] **Step 3: Implement** the types and both modules.
- [ ] **Step 4: Run** `npx vitest run src/bible` and `npm run typecheck`. Both should pass. Fix `makeOpened` in
  `fakeBridge.ts` to include `bible: emptyBible()`.
- [ ] **Step 5: Commit:** `feat(bible): fact types and deterministic contradiction detection (vrs-063.4)`.

### Task 4: Bible operations (facts, decisions, dependencies, cascade)

**Files:**
- Create: `src/bible/ops.ts`
- Test: `src/bible/bible.test.ts`

**Interfaces:**
- Consumes: the Task 3 types, `contradictionKey`, `attributeKey`, `Contradiction`.
- Produces (all pure; each returns a new `Bible` and never mutates):
  ```ts
  addFact(b: Bible, fact: Fact): Bible
  updateFact(b: Bible, id: string, patch: Partial<Omit<Fact,'id'|'createdAt'>>, now: string): Bible
  setFactStatus(b: Bible, id: string, status: FactStatus, now: string): Bible
  keepOne(b: Bible, c: Contradiction, versionIndex: number, d: { id: string; note?: string; now: string }): Bible
  keepAll(b: Bible, c: Contradiction, d: { id: string; note?: string; now: string }): Bible
  reopen(b: Bible, decisionId: string, now: string): Bible
  addDependency(b: Bible, dep: Dependency): Bible   // no-op for self or duplicate pairs
  removeDependency(b: Bible, id: string): Bible
  removeEntities(b: Bible, ids: ReadonlySet<string>): Bible
  ```
  - **`keepOne`:** the chosen version's facts become `kept` and every other version's facts become `set_aside`.
    It pushes a `kept_one` decision with `factIds = c.factIds` and `setAsideIds` set to the facts it changed.
  - **`keepAll`:** every fact becomes `kept`. It removes any earlier `kept_all` decision for the same
    `contradictionKey`, then pushes a `kept_all` decision.
  - **`reopen`:** restores to `kept` only those `setAsideIds` still `set_aside`, then deletes the decision.
  - **`removeEntities`:** drops facts, decisions and dependencies (either end) that touch `ids`. Facts whose
    `source.itemId` is in `ids` are kept untouched.

- [ ] **Step 1: Write failing tests:**
  - `keepOne` on a 2-version contradiction → the chosen version is `kept`, the other `set_aside`, and the
    decision's `setAsideIds` equals the other version's ids.
  - `findContradictions` afterwards returns none.
  - `reopen` → both versions are `kept` again, the decision is gone, and the contradiction reappears.
  - A fact set aside by `setFactStatus` before the decision isn't restored by `reopen`.
  - `keepAll` twice on the same key leaves exactly one decision.
  - `removeEntities` of an event removes the dependencies where it is either `eventId` or `afterEventId`,
    plus its facts and decisions. A fact on another entity whose `source.itemId` is the removed id survives.
  - `addDependency` with `eventId === afterEventId` is a no-op.
- [ ] **Step 2: Run** `npx vitest run src/bible`. It should fail.
- [ ] **Step 3: Implement** `ops.ts`.
- [ ] **Step 4: Run** `npx vitest run src/bible`. It should pass.
- [ ] **Step 5: Commit:** `feat(bible): fact, decision and dependency operations (vrs-063.4)`.

### Task 5: Ordering checks, timeline placement, source resolution, backlinks

**Files:**
- Create: `src/bible/ordering.ts`, `src/bible/timeline.ts`, `src/bible/sources.ts`, `src/bible/links.ts`
- Test: `src/bible/bible.test.ts`

**Interfaces:**
- Consumes: Tasks 3–4.
- Produces:
  ```ts
  // ordering.ts
  export type Check = 'ok' | 'violated' | 'unknown';
  export function strictlyAfter(a: StoryPosition, b: StoryPosition): 'yes'|'no'|'unknown';
  export function keptPositions(b: Bible, eventId: string): StoryPosition[];      // one per kept `when` version
  export interface DependencyCheck { dependencyId: string; otherEventId: string; direction: 'after'|'before'; result: Check }
  export function checkPosition(b: Bible, eventId: string, candidate: StoryPosition): DependencyCheck[];
  export function eventsInCycles(b: Bible): Set<string>;
  // timeline.ts
  export interface TimelineEntry { eventId: string; position: StoryPosition; versionIndex: number;
    versionCount: number; violated: boolean; inCycle: boolean }
  export interface Timeline { contested: string[]; placed: TimelineEntry[]; unplaced: string[] }
  export function buildTimeline(b: Bible, items: TreeItem[]): Timeline;
  // sources.ts
  export type SourceState = { status: 'exact'|'relocated'; start: number; end: number } | { status: 'missing'|'deleted' };
  export function resolveSource(source: FactSource, body: string | undefined, itemExists: boolean): SourceState;
  // links.ts
  export function eventsLinkingTo(items: TreeItem[], entityId: string): TreeItem[];      // event entities whose references target it
  export function factsCitingItems(b: Bible, itemIds: ReadonlySet<string>): Fact[];
  ```
  - **`strictlyAfter`:** compare seasons, and return yes or no if they differ. If the seasons are equal and
    either episode is missing, return unknown. Otherwise compare episodes; if those are equal and either
    order is missing, return unknown. Otherwise compare orders, where equal means `no`.
  - **`checkPosition`:**
    - Direction `after`: the event depends on another event, `dep.eventId === eventId`, and the test is
      `strictlyAfter(candidate, other)`.
    - Direction `before`: another event depends on this one, and the test is `strictlyAfter(other, candidate)`.
    - With no kept positions on the other event, the result is `unknown`.
    - The result is `ok` if every other position passes, `violated` if every one fails, and otherwise `unknown`.
  - **`buildTimeline`** considers only items with `type === 'entity' && entityKind === 'event'`:
    - An open contradiction on `when` → the event goes in `contested`.
    - No live `when` → `unplaced`.
    - Otherwise there's one entry per kept version, sorted by `comparePositions` and then title.
    - `violated` is true if any `checkPosition` result for that entry is `violated`.

- [ ] **Step 1: Write failing tests:**
  - `strictlyAfter({3},{3,4})` → unknown, and `({5,2},{4,1})` → yes.
  - The Mira scenario:
    - "Hal dies" is at `{3,4}`. "Ren joins" is at `{4,1}` and depends on "Mira dies".
    - Mira has candidates `{3,10}` and `{5,2}`, and depends on Hal.
    - `checkPosition` gives `{3,10}` → all `ok`, while `{5,2}` → the `before` check against "Ren joins" is
      `violated`.
  - A cycle A→B→A shows up in `eventsInCycles`.
  - `buildTimeline`:
    - A `kept_all` event with 2 `when` values → 2 entries, `versionCount 2`.
    - An open `when` contradiction → `contested`.
    - No `when` → `unplaced`.
    - An entity whose `entityKind` was changed to `character` (Review Focus 4) → absent.
    - After `removeEntities` of a depended-upon event, no entry is `violated` (Review Focus 3).
  - `resolveSource`:
    - Exact match at the stored offsets → `exact`.
    - The text was shifted by inserted characters → `relocated` with the new offsets.
    - The quote is gone → `missing`.
    - `itemExists:false` → `deleted`.
- [ ] **Step 2: Run** `npx vitest run src/bible`. It should fail.
- [ ] **Step 3: Implement** the four modules. `eventsInCycles` is a DFS over `afterEventId` edges.
- [ ] **Step 4: Run** `npx vitest run src/bible`. It should pass.
- [ ] **Step 5: Commit:** `feat(bible): ordering checks, timeline placement and source resolution (vrs-063.4)`.

### Task 6: Renderer state wiring

**Files:**
- Modify: `src/project/projectState.ts`, `src/project/useProject.ts`, `src/test/fakeBridge.ts`
- Test: `src/project/projectState.test.ts`, `src/project/useProject.test.ts`

**Interfaces:**
- Consumes: `Bible`, `emptyBible`, and `removeEntities` (Task 4).
- Produces:
  - `ProjectState` gains `bible: Bible` and `savedBible: Bible`.
  - A new action `{ type: 'bibleUpdated'; update: (b: Bible) => Bible }`.
  - `structureReloaded` gains a `bible`, and `opened` takes `project.bible`.
  - `itemDeleted` applies `removeEntities` to the removed ids that are entities.
  - `recoveryRestored` takes `snapshot.bible`.
  - `isStructureDirty` includes `bible !== savedBible`, and `buildSavePayload` includes `bible` when it has changed.
  - `useProject` returns `updateBible(update)` and `importText(): Promise<TextImport | null>`. The external
    change of `bible/bible.json` is handled exactly like `tree.json`.

- [ ] **Step 1: Write failing tests** in `projectState.test.ts`:
  - `opened` sets `bible` and `savedBible`.
  - `bibleUpdated` marks the project dirty, and `buildSavePayload` contains `bible`.
  - `saved` makes it clean again.
  - `itemDeleted` of an entity removes its facts. Deleting a chat leaves the facts that cite it.
  - `structureReloaded` replaces `bible`.

  In `useProject.test.ts`, an external change to `bible/bible.json` while the bible is dirty adds
  `STRUCTURE_CONFLICT`, and while it is clean it reloads.
- [ ] **Step 2: Run** `npx vitest run src/project`. It should fail.
- [ ] **Step 3: Implement.** The fake bridge's `disk` gains `bible`, and `readStructure` and `save` handle it.
- [ ] **Step 4: Run** `npx vitest run src/project` and `npm run typecheck`. Both should pass.
- [ ] **Step 5: Commit:** `feat(bible): carry the bible through project state, save, recovery and reload (vrs-063.4)`.

### Task 7: Entity and chat item types, import, read-only chat view

**Files:**
- Modify: `src/workspace/research.ts`, `src/components/workspace/ItemIcon.tsx`,
  `src/components/workspace/AddItemModal.tsx`, `src/components/workspace/Workspace.tsx`,
  `src/components/workspace/DocumentEditor.tsx`
- Create: `src/bible/entities.ts`, `src/components/bible/ImportChatModal.tsx`, `src/components/bible/ChatView.tsx`
- Test: `src/bible/bible.test.ts`, `src/components/workspace/Workspace.test.tsx`

**Interfaces:**
- Produces:
  - `ENTITY_KINDS: { id: EntityKind; name: string; icon: LucideIcon }[]`, in `entities.ts`. The icons are
    User, MapPin, Shield, Package, ScrollText, CalendarClock and GitBranch, in kind order. It also exports
    `entityKindOf(item): EntityKind | null` and `isEvent(item)`.
  - `normalizeChatText(s: string): string` (BOM strip, CRLF/CR → LF).
  - `ITEM_TYPES` gains `{id:'entity',name:'Entity'}`. Chat is **not** in the Add Item list, because it's
    created only through Import chat, but `itemType` recognises `'chat'`.
  - `ItemIcon` takes `Pick<TreeItem,'type'|'entityKind'>`. It uses the kind icon for entities and
    `MessageSquare` for chats.
  - `ChatView({ text, highlight?: {start:number,end:number} | null, onSelectRange?(r: {start,end,quote}): void })`
    renders the text in a `<pre class="whitespace-pre-wrap">`. It computes selection offsets from the DOM
    selection, so they map 1:1 to the stored text.
  - The Workspace toolbar's add menu gets an "Import chat" entry, which opens `ImportChatModal` with a paste
    textarea and a "From file…" button (`importText`). Creating the chat makes a
    `{type:'chat', title, importedFrom?}` item whose body is the normalized text.
  - `DocumentEditor` renders `ChatView` for chat items, with no edit toolbar and no textarea.

- [ ] **Step 1: Write failing tests:**
  - `normalizeChatText('\uFEFFa\r\nb\rc')` → `'a\nb\nc'`.
  - A Workspace test pastes `"You: hi\r\nAI: hello"` into Import chat. A chat item appears in the binder,
    the stored body has no `\r`, and opening it shows no textarea.
  - Add Item → Entity → kind "Event" creates an item with `entityKind:'event'`.
- [ ] **Step 2: Run** `npx vitest run src`. It should fail.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npx vitest run src`. It should pass.
- [ ] **Step 5: Commit:** `feat(bible): entity and chat binder items with read-only chat view (vrs-063.4)`.

### Task 8: Entity page facts panel

**Files:**
- Create: `src/components/bible/EntityPanel.tsx`, `src/components/bible/FactForm.tsx`,
  `src/components/bible/PositionFields.tsx`, `src/components/bible/SourceLink.tsx`
- Modify: `DocumentEditor.tsx` (render `EntityPanel` above the body for entity items), `Workspace.tsx`
  (pass the bible controller and an `openSource(source)` navigation)
- Test: `src/components/bible/EntityPanel.test.tsx`

**Interfaces:**
- Consumes: `updateBible` plus the ops (Task 4), `findContradictions`/`groupVersions` (Task 3),
  `resolveSource` (Task 5).
- Produces:
  - `FactForm({ entities: TreeItem[]; fixedEntityId?: string; source?: FactSource; attributeSuggestions(kind): string[]; onSubmit(f: { entityId?: string; newEntity?: { title: string; kind: EntityKind }; attribute: string; value: string | StoryPosition }): void; onCancel(): void })`.
    It switches the value input to `PositionFields` when `isWhenAttribute(attribute)`. Task 10 reuses it.
  - `attributeSuggestions(b: Bible, items: TreeItem[], kind: EntityKind | null): string[]`, in
    `src/bible/entities.ts`. It returns the distinct attributes already used on entities of that kind,
    most used first, plus `when` for events.
  - `SourceLink({ source, state: SourceState, title?: string, onOpen(): void })`. It shows the quote, then the
    source title, or "passage no longer found" or "source deleted" depending on the state.
  - `EntityPanel`:
    - **Kept facts**, grouped by attribute. An attribute with a `kept_all` decision shows "multiple versions
      kept" and its note.
    - **Pending (proposed) facts**, with Keep and Set aside buttons.
    - **An open contradiction marker**, which links to the conflict queue and calls the
      `onShowConflict(key)` prop.
    - **A collapsed "Set aside" section**, with a Restore button on each fact.
    - **"Add fact"**, which opens `FactForm` with `fixedEntityId` and creates the fact with
      `status:'kept', origin:'manual'`, new ids from `crypto.randomUUID()`, and ISO timestamps.

- [ ] **Step 1: Write failing tests:**
  - Adding a fact `death = "Season 3 finale"` shows it under Kept.
  - Adding a second differing `Death` fact shows the contradiction marker.
  - A proposed fact shows Keep and Set aside. Set aside moves it into the collapsed section, and Restore
    brings it back.
  - `attribute 'when'` renders season/episode/order number inputs.
- [ ] **Step 2: Run** `npx vitest run src/components/bible`. It should fail.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npx vitest run src/components/bible`. It should pass.
- [ ] **Step 5: Commit:** `feat(bible): entity page facts panel (vrs-063.4)`.

### Task 9: Event details: when, dependencies, participants, backlinks

**Files:**
- Modify: `src/components/bible/EntityPanel.tsx`
- Create: `src/components/bible/EventLinks.tsx`
- Test: `src/components/bible/EntityPanel.test.tsx`

**Interfaces:**
- Consumes: `checkPosition`, `eventsInCycles`, `keptPositions`, `eventsLinkingTo`, `addDependency`/`removeDependency`.
- Produces, for event entities:
  - **"When"** shows `formatPosition` of the kept positions.
  - **"Must come after"** lists the dependencies, each with a remove button, plus an event picker to add one.
    It shows a check line per dependency (✓/✗/?), and a cycle warning when the event is in
    `eventsInCycles`.
  - **"Participants"** shows the event's `references` whose targets are entities other than plotlines.
  - **"Plotline"** shows the references whose targets are plotline entities.
  - **Non-event entities** get an "Events" list (`eventsLinkingTo`). Plotlines sort it by `buildTimeline`
    order, with unplaced events last.

- [ ] **Step 1: Write failing tests:**
  - Event B "must come after" A, with A at `{3,4}` and B at `{3,2}` → B's panel shows a ✗ line naming A.
  - A character referenced by two events lists both under Events.
  - A plotline lists its events in season order.
- [ ] **Step 2: Run** `npx vitest run src/components/bible`. It should fail.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npx vitest run src/components/bible`. It should pass.
- [ ] **Step 5: Commit:** `feat(bible): event timing, dependencies and backlinks on entity pages (vrs-063.4)`.

### Task 10: Capture by selection and open-passage

**Files:**
- Create: `src/components/bible/CapturePopover.tsx`
- Modify: `ChatView.tsx`, `DocumentEditor.tsx` (textarea `onSelect`/`onMouseUp` in source mode only; the
  preview has no capture), `Workspace.tsx` (`openSource` navigates to the item and passes `highlight`)
- Test: `src/components/bible/CapturePopover.test.tsx`

**Interfaces:**
- Consumes: `FactForm` (Task 8) and `addFact`.
- Produces: `CapturePopover({ anchor: DOMRect; source: FactSource; …FactForm props })`.
  - It appears for a non-empty selection, positioned at the selection. Escape and outside clicks close it.
  - Submitting creates the fact (and the new entity, via `addItem` with `type:'entity'`, when one is
    requested) with `source = { itemId, quote, start, end }`.
  - `highlight` selects the range in the textarea (`setSelectionRange`, then focus) or marks it in `ChatView`
    with a `<mark>` and `scrollIntoView`.

- [ ] **Step 1: Write failing tests:**
  - In `ChatView`, simulate a selection over "Mira dies" with the `onSelectRange` callback. The popover
    opens, and submitting with entity "Mira" (new, character), attribute `death`, value `S3 finale` creates
    the entity and a fact whose `source.quote === 'Mira dies'` and whose offsets slice the body back to the
    quote.
  - `resolveSource` on that source → `exact`.
- [ ] **Step 2: Run** `npx vitest run src/components/bible`. It should fail.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npx vitest run src/components/bible`. It should pass.
- [ ] **Step 5: Commit:** `feat(bible): capture facts from selected passages (vrs-063.4)`.

### Task 11: Conflict queue view

**Files:**
- Create: `src/components/bible/ConflictQueue.tsx`
- Modify: `Workspace.tsx`. Add `mode: 'research' | 'conflicts' | 'timeline'` state. Two toolbar buttons,
  "Conflicts" (with the open count as a badge) and "Timeline", replace the content pane while the binder
  stays. Picking a binder item returns to `research`.
- Test: `src/components/bible/ConflictQueue.test.tsx`

**Interfaces:**
- Consumes: `findContradictions`, `openContradictions`, `keepOne`, `keepAll`, `reopen`, `checkPosition`,
  `resolveSource`, `SourceLink`.
- Produces: `ConflictQueue({ bible, items, contentOf, focusKey?: string, onUpdate(update), onOpenSource(source), onOpenEntity(id) })`.
  - **Left side:** a filter (Open | Decided). The list shows "<entity title> · <attribute>" with
    "<n> versions" under it.
  - **Right side:** one card per version, showing:
    - the value (or `formatPosition`);
    - each source as a `SourceLink` (corroborating sources stacked);
    - for `when` contradictions on events, the `checkPosition` lines (✓ after X / ✗ must come before Y / ? unknown);
    - a **Keep this one** button.
  - **Under the cards:** a **Keep both / Keep all** button and an optional note field.
  - **Decided filter:** lists decisions with kind, note and date, each with **Reopen**.

- [ ] **Step 1: Write failing tests:**
  - With two differing `death` facts, the badge reads 1 and the queue shows 2 cards.
  - "Keep this one" on card 1 → the badge reads 0, Decided lists it, and Reopen brings it back to Open.
  - "Keep both" with note "branch" → the entity page shows "multiple versions kept" and "branch".
  - The Mira scenario from Task 5 shows ✗ on the S5 card only.
- [ ] **Step 2: Run** `npx vitest run src/components/bible`. It should fail.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npx vitest run src/components/bible`. It should pass.
- [ ] **Step 5: Commit:** `feat(bible): conflict queue with side-by-side versions (vrs-063.4)`.

### Task 12: Timeline view

**Files:**
- Create: `src/components/bible/TimelineView.tsx`
- Modify: `Workspace.tsx` (the `timeline` mode)
- Test: `src/components/bible/TimelineView.test.tsx`

**Interfaces:**
- Consumes: `buildTimeline`, `formatPosition`.
- Produces: `TimelineView({ bible, items, onOpenEntity(id), onShowConflict(key) })`.
  - **"Timing contested"** comes first, flagged, each item linking to its conflict.
  - Then the season groups, in order. Each row shows the position, the event title, "version n of m" when
    `versionCount > 1`, and a ✗ badge (violated) or cycle badge.
  - **"Unplaced"** comes last.

- [ ] **Step 1: Write failing tests:**
  - Events at S4E1, S3E4 and S3 (no episode) render under the headings "Season 3" (S3 then S3E4) and
    "Season 4".
  - A contested event appears only in "Timing contested".
  - Clicking a row calls `onOpenEntity`.
- [ ] **Step 2: Run** `npx vitest run src/components/bible`. It should fail.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npx vitest run src/components/bible`. It should pass.
- [ ] **Step 5: Commit:** `feat(bible): browsable story timeline (vrs-063.4)`.

### Task 13: Delete warning and Markdown export

**Files:**
- Create: `src/bible/exportMarkdown.ts`
- Modify: `src/workspace/dossier.ts`, `src/components/workspace/Workspace.tsx` (delete confirmation text),
  `src/components/workspace/ExportModal.tsx` if it calls `generateDossier`
- Test: `src/bible/bible.test.ts`, `src/workspace/workspaceLib.test.ts`, `Workspace.test.tsx`

**Interfaces:**
- Produces: `storyBibleMarkdown(items: TreeItem[], bible: Bible): string`. It returns `''` when the project
  has no entities.
  - **Heading:** `## Story Bible`.
  - **One `### <Kind name>` per kind present.** Each entity is a `#### <title>` with a bullet per kept
    attribute: `- **death:** Season 3 finale`. An attribute with several kept values gets a bullet per value
    plus a `*(multiple versions kept: <note>)*` marker.
  - **`### Unresolved`:** one bullet per open contradiction, listing its versions.
  - **`### Timeline`:** a bullet per placed entry in order, as `S3 · E4: Hal dies`, then the contested and
    unplaced events.
- `generateDossier(projectName, items, contentOf, exportedAt?, bible?: Bible)` appends `storyBibleMarkdown`
  when a bible is given.
- **Delete confirmation:** it adds "N facts cite this item. They'll keep their quotes." when
  `factsCitingItems` over the subtree is non-empty. It adds "This removes M facts about it." when the
  subtree contains entities that have facts.

- [ ] **Step 1: Write failing tests:**
  - An export of the Mira fixture contains `## Story Bible`, `#### Mira`, `- **death:** Season 3 finale`,
    `### Unresolved` (with an open contradiction present), and the timeline lines in order.
  - With no entities, the dossier is unchanged.
  - Deleting a chat cited by 2 facts shows "2 facts cite this item".
- [ ] **Step 2: Run** `npx vitest run src`. It should fail.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npx vitest run src`. It should pass.
- [ ] **Step 5: Commit:** `feat(bible): story-bible export section and delete warnings (vrs-063.4)`.

### Task 14: End-to-end, docs, gate, beads

**Files:**
- Create: `e2e/bible/bible.spec.ts`
- Modify: `CLAUDE.md` (a "Story Bible" section: the `bible/bible.json` shape, save order, pure logic in
  `src/bible/`, the no-routes rule, and how a fact's `source` offsets are taken from the chat display
  or editor and resolved later)

- [ ] **Step 1: Write e2e tests** using the existing fixtures (`stubFolderDialogs`, `stubMessageBox`).
  - **Test 1:**
    1. Create a project and import a chat by pasting text that contains CRLF.
    2. Select "Mira dies" in the chat view by setting the selection with `window.evaluate` and dispatching
       `mouseup`.
    3. Capture `death = Season 3 finale` on a new character Mira.
    4. On Mira's page, add `death = Season 5` manually.
    5. The Conflicts badge reads 1. Use "Keep this one" on Season 3, then save.
    6. Assert that `bible/bible.json` on disk has one `kept` and one `set_aside` fact and a `kept_one` decision.
    7. Quit and relaunch, then reopen from recents. The badge reads 0, and Decided lists the decision.
  - **Test 2:**
    1. Create events Hal dies `{3,4}`, Ren joins `{4,1}` and Mira dies `{5,2}`, with Ren after Mira and Mira
       after Hal.
    2. The timeline shows the ✗ badge on Mira dies, and "Season 3" comes before "Season 4".
- [ ] **Step 2: Run** `npm run test:e2e -- e2e/bible`. It should pass. Fix any real defects in the owning
  task's code.
- [ ] **Step 3: Write** the `CLAUDE.md` section.
- [ ] **Step 4: Run** `npm run gate`. Typecheck, lint, unit and e2e should all pass.
- [ ] **Step 5: File the follow-ups and close the issue:**
  - `bd create "Import structured ChatGPT/Claude chat exports into chats/" -p 3 --parent vrs-063`
  - `bd create "Attribute rename/merge tool for story-bible facts" -p 3 --parent vrs-063`
  - Close `vrs-063.4`.
- [ ] **Step 6: Commit:** `docs(bible): document the story bible; e2e coverage (vrs-063.4)` and
  `chore(beads): close vrs-063.4; file follow-ups`. Ask the user before pushing.
