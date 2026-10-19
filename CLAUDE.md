# Project Instructions for AI Agents

This file provides instructions and context for AI coding agents working on this project.

<!-- BEGIN BEADS INTEGRATION v:1 profile:minimal hash:7510c1e2 -->
## Beads Issue Tracker

This project uses **bd (beads)** for issue tracking. Run `bd prime` to see full workflow context and commands.

### Quick Reference

```bash
bd ready              # Find available work
bd show <id>          # View issue details
bd update <id> --claim  # Claim work
bd close <id>         # Complete work
```

### Rules

- Use `bd` for ALL task tracking — do NOT use TodoWrite, TaskCreate, or markdown TODO lists
- Run `bd prime` for detailed command reference and session close protocol
- Use `bd remember` for persistent knowledge — do NOT use MEMORY.md files

**Architecture in one line:** issues live in a local Dolt DB; sync uses `refs/dolt/data` on your git remote; `.beads/issues.jsonl` is a passive export. See https://github.com/gastownhall/beads/blob/main/docs/SYNC_CONCEPTS.md for details and anti-patterns.

## Session Completion

**When ending a work session**, you MUST complete ALL steps below. Work is NOT complete until `git push` succeeds.

**MANDATORY WORKFLOW:**

1. **File issues for remaining work** - Create issues for anything that needs follow-up
2. **Run quality gates** (if code changed) - Tests, linters, builds
3. **Update issue status** - Close finished work, update in-progress items
4. **PUSH TO REMOTE** - This is MANDATORY:
   ```bash
   git pull --rebase
   git push
   git status  # MUST show "up to date with origin"
   ```
5. **Clean up** - Clear stashes, prune remote branches
6. **Verify** - All changes committed AND pushed
7. **Hand off** - Provide context for next session

**CRITICAL RULES:**
- Work is NOT complete until `git push` succeeds
- NEVER stop before pushing - that leaves work stranded locally
- NEVER say "ready to push when you are" - YOU must push
- If push fails, resolve and retry until it succeeds
<!-- END BEADS INTEGRATION -->


## Project Overview

Vangard Research Studio (VRS) is a standalone Electron + React 19 + TypeScript desktop app for visual-novel
writers. It's a workspace for collecting and creating story research (documents, images, audio, web clips,
maps, chat transcripts), plus a story bible: structured entities and facts, global canon, and conflict detection.

- **Standalone by design.** VRS shares no code with Vangard Studio (`bmf-vangard-renpy-ide`) or
  `bmf-vangard-vnstorybible`. Infrastructure *copied* from Vangard (path guards, atomic writes, logger) lives
  in `electron/lib/` and is owned here from now on.
- **AI is strictly opt-in.** Every AI feature must stay hidden and inert until the user enables AI in Settings
  and provides an API key. Main-process AI handlers must refuse calls while AI is disabled. Never make a
  non-AI feature depend on AI.

## Build & Test

```bash
npm run build           # Vite renderer build -> dist/
npm run electron:start  # build + launch Electron
npm run dev             # renderer only, in a browser (no preload bridge: window.vrs is undefined)
npm test                # Vitest: 'main' project (Node) + 'renderer' project (jsdom)
npm run test:e2e        # builds, then Playwright drives the real Electron app
npm run typecheck
npm run lint
npm run gate            # typecheck + lint + unit + e2e -- run before closing an issue
```

## Architecture

```
electron/main.js        main process: window, CSP, IPC handlers
electron/preload.js     sandboxed preload; exposes window.vrs (CommonJS by necessity)
electron/lib/           main-process modules, each with a co-located *.test.ts
src/                    React renderer (App.tsx, index.css theme tokens, vite-env.d.ts declares window.vrs)
src/project/             project types, IPC unwrapping (api.ts), pure reducer (projectState.ts), useProject hook
src/workspace/           pure workspace logic: treeOps (move/duplicate), search, stats, dossier export, markdown, asset cache
src/components/workspace/ binder, document editor, inspector, corkboard, outliner, split pane, dialogs (Workspace.tsx is the root)
src/ai/                 renderer AI layer: aiApi.ts (llm/settings IPC wrapper), useAi hook, types
src/chat/               pure AI Chat logic (transcript, buildChatRequest, personas, searchSuggestions) + useChatStreams
src/components/chat/    AI Chat editor, header, message view, attachments, persona drawer, search suggestions
src/components/settings/ SettingsDialog (AI toggle, provider keys, default model)
electron/lib/llm/       provider adapters (providers/), http.js, sse.js, sources.js, llmService.js, testOverride.js
src/bible/              pure story-bible logic: ops, contradictions, ordering, timeline, sources, export (no React, no IPC)
src/components/bible/   entity facts panel, chat view + capture popover, conflict queue, timeline view
src/extraction/         pure AI-extraction logic: source turns, prompt + canon, apply (matching, fingerprints), review; useExtraction
src/components/extraction/ Extract dialog and review queue
e2e/                    Playwright Electron tests (electron-launch.ts fixture: isolated userData, dialog stubs)
```

## Projects and Storage

A project is a folder (`Name.vrs/`) of plain files: `vrs.json` (manifest + `schemaVersion`), `tree.json`
(binder items), `docs/<id>.md`, `chats/<id>.json` (AI Chat transcripts), plus `assets/ bible/ maps/`.

- **Main process owns the disk.** `electron/lib/projectStore.js` reads/writes a root; `projectSession.js` holds
  the one open root. Roots come only from native dialogs or the recent list (`recentProjects.js`) -- the
  renderer can never name a folder.
- **Schema changes** bump `CURRENT_SCHEMA_VERSION` and add a step to `MIGRATIONS` in `projectSchema.js`.
  Opening an older project migrates it and keeps `*.v<N>.bak` copies. Newer formats are refused (`TOO_NEW`).
- **Item ids become file names**: always validate with `isValidItemId()`.
- **Save order** is docs, chats, `tree.json`, `bible/bible.json`, `bible/extraction.json`, `vrs.json`, then deletions, so an interrupted save
  never leaves the tree pointing at a missing file.
- **Crash recovery** snapshots (same shape as a save payload) live in `userData/recovery/`, never in the project
  folder, and are cleared on save or an explicit discard.
- **External edits**: `projectWatcher.js` filters VRS's own writes by content hash (not timing). The renderer
  reloads clean files and asks before replacing unsaved ones.
- **IPC results** are `{ ok, value | error: { code, message } }` envelopes; `src/project/api.ts` unwraps them.
- **Binder items** are `tree.json` entries (synopsis, label, status, notes, citations, references by id, `asset`);
  every item's body is `docs/<id>.md`. All bodies are loaded on open (search, word counts and export need them).
  `readDoc` (`src/project/api.ts`) strips a BOM and turns CRLF/CR into LF, matching the editor textarea, so fact offsets
  captured there resolve against the stored body.
- **Imported chats** (`type: 'chat'`) come from `project:import-texts` (multi-select; extensionless files, dotted names like `Scene 2.1 draft` included, only if they
  decode cleanly as text; UTF-16 is detected by BOM or NUL pattern, `detectEncoding` in `electron/lib/textImport.js`) or paste. `src/chat/importFormats.ts` recognises AI Chat Exporter Markdown (AI Studio) and AI Studio's own Drive
  files (extensionless JSON, `chunkedPrompt.chunks[]`; thinking dropped, media chunks become `[... not imported]`
  placeholders, consecutive same-role chunks merge) and stores both in the canonical turn layout (`=== You ===` / `=== <Model> ===` heading lines; `turnSpans()` finds turns in a stored body),
  with `importedFormat` and `sourceUrl` on the item. Anything else is stored as plain text. Only an item with that
  `importedFormat` has turns (`hasTurnLayout`): a `=== Scene 2 ===` line in a plain chat or document is just text. `ChatView`
  styles the headings (its `turns` prop) without changing the text, so fact offsets stay offsets into the stored body.
- **Media** is copied into `assets/<id>.<ext>` by `project:import-media` (native dialog; name chosen in main,
  allowlist in `electron/lib/media.js`). The renderer reads bytes via `project:read-asset` and shows them through
  `blob:` URLs (`src/workspace/assetCache.ts`), never by path. Unwanted assets ride along in a save's
  `deletedAssets`; the main process keeps any the saved tree still references.
- **Links** go through `app:open-external` (http/https only). Never navigate the app window; Markdown previews
  intercept link clicks.
- **E2E** must stub every native dialog (`stubFolderDialogs`, `stubMessageBox`); an unstubbed dialog hangs
  the run on the developer's screen. Use `crashApp()`, not `process().kill()`, to simulate a crash.

## Story Bible

Structured canon lives in `bible/bible.json`: `{ facts, dependencies, decisions, sourceOrder? }`. Unknown fields are kept.
`sourceOrder` lists chat, AI chat and document ids oldest first (`src/bible/sourceOrder.ts`; new ones join as newest,
deleted ones are pruned on save; unlisted ones count as oldest; bad or repeated ids are dropped on read, never refused). The file has no
version field; the project's `schemaVersion` in `vrs.json` (now 2) covers it.

- **Facts** are `{ id, entityId, attribute, value, status, source?, origin, note?, createdAt, updatedAt }`. `status` is
  `proposed` (unreviewed), `kept` or `set_aside`. Manual facts are created `kept` with origin "manual"; AI-extracted
  facts would be `proposed` (AI Chat only lets the user capture passages as manual facts). A `when` attribute holds a story position `{ season, episode?, order? }` instead of text.
- **Dependencies** (`eventId` must come after `afterEventId`) order events; they are checked against kept `when` facts.
  A cycle or a violated order is flagged, never blocked.
- **Decisions** (`kept_one`, `kept_all`) are stored with the `factIds` kept and `setAsideIds` changed, so Reopen undoes
  exactly one decision and nothing else.
- **Contradictions** are derived (never stored): the same entity + attribute with 2+ distinct non-set-aside values
  (proposed or kept; `when` compared as compatible positions). A `kept_all` decision covering exactly that live fact
  set acknowledges it; `kept_one` resolves it by setting the other versions aside; adding a new differing fact
  reopens an acknowledged one.
- **Save order**: docs, chats, `tree.json`, `bible/bible.json`, `bible/extraction.json`, `vrs.json`, then deletions.
- **Pure logic in `src/bible/`**, state changes as `Bible -> Bible` functions applied through `updateBible`. No React or IPC there.
- **No routes.** Canon is global; route-scoped canon is out of scope for this phase.
- **Sources**: a fact's `source` is `{ itemId, messageId?, quote, start, end }`. Offsets are taken from the plain text shown (the
  read-only chat `<pre>` or the editor textarea), in the same text that is stored. Later they are resolved by
  `resolveSource`: exact match at the offsets, else the first occurrence of the quote, else missing (or deleted item).
  With `messageId` (an AI Chat message) offsets are into that message's stored text; a deleted message resolves to
  missing with reason "message was deleted".
- **Entities** are binder items (`type: 'entity'`, `entityKind`); events show When / Must come after instead of plain facts.
- **Card wall** (Workspace "Cards" mode; logic in `src/bible/cards.ts`, UI `CardWall` + `EntityCard`): a tab per kind (plus
  "Other"), cards show kept facts only. Pins are `cardFacts` (attribute keys) on the entity item; with none, a per-kind
  `DEFAULT_CARD_ORDER` applies. The portrait is `portraitId`, else the first linked image. Media and related entities are
  plain `references`; "Import image/audio…" on the full card (`importMediaOnto` in `useProject`) creates the item beside the
  entity and links it. `EntityPanel` (in the editor) stays the place for full fact editing, set-aside facts and unreviewing.

## AI Layer and AI Chat

Strictly opt-in (see Project Overview). Main-process code in `electron/lib/`, renderer in `src/ai/`, `src/chat/`.

- **Settings** live in `userData/settings.json` (`appSettings.js`: `theme`, `ai.{enabled, defaultProvider, defaultModel, providers[id].lastTestOk}`;
  unknown fields kept; missing/corrupt reads as defaults; one instance in `main.js`, shared so writes queue together).
  `theme` (`system`/`light`/`dark`, `themeSetting.js`, `settings:get-theme`/`settings:set-theme`, `src/settings/theme.ts`) is
  not AI: main applies it as `nativeTheme.themeSource` before the window opens, so the CSS only follows `prefers-color-scheme`
  (e2e must call `emulateMedia({ colorScheme: null })` to see it). **Keys** live in `userData/ai-keys.json` (`apiKeys.js`), each value
  `safeStorage`-encrypted; `set` refuses (`UNAVAILABLE`) when encryption is unavailable, never plaintext. An unreadable or corrupt
  store throws instead of being overwritten and surfaces as `AiStatus.keyStoreProblem`; Settings then offers "Reset stored keys"
  (`llm:reset-keys`), which renames it to `ai-keys.json.corrupt-<ts>`, turns AI off and clears every `lastTestOk` (refused while
  the store reads fine). Keys never reach the renderer.
- **Opt-in rule** (`llmService.js`): every `llm:*` channel except `llm:save-key`, `llm:remove-key`, `llm:reset-keys` and `llm:test` refuses with
  `AI_DISABLED` while AI is disabled. Enabling (`settings:set-ai`) needs a provider with a saved key and a passing test
  (`lastTestOk`); `llm:save-key` stores a key only after a model-list call succeeds. Removing the last configured key
  (`llm:remove-key`) turns AI off (and aborts in-flight requests). Disabling calls `abortAll()`, which aborts
  every in-flight request and never throws (also used on project close and window close). `abortEpoch` is bumped by each
  `abortAll()` so a chat start that was awaiting settings/keys notices and ends `CANCELLED`.
- **`electron/lib/llm/`**: `http.js` (`LlmError`, `requestJson`/`requestStream`; `scrub()` redacts keys, and every
  provider-derived message passes through it), `sse.js` (SSE reader), `sources.js` (`normalizeSources`: dedupe, http(s) only),
  `providers/{gemini,anthropic,openai}.js`. Each adapter has a capability table (`capabilitiesFor`: webSearch, readUrls,
  temperature by model id) at the top and a header comment listing the wire-format rules. Provider wire formats must be
  re-checked against the provider docs whenever an adapter changes.
- **Transcripts**: `chats/<id>.json` is `{ version: 1, settings, messages }`; unknown fields are kept (`src/chat/transcript.ts`).
  The item type is `'ai-chat'` (`AI_CHAT_TYPE`), distinct from the imported `'chat'` type (a pasted text transcript whose body is
  `docs/<id>.md`). Chats ride in the save payload's `chats` (`null` deletes the file). `forPersistence()` saves any `streaming`
  message as `cancelled`; a transcript still streaming is never written as streaming. A reply the provider stopped early
  ends with `done.truncated` (`max_tokens` | `pause_turn` | `other`, set by each adapter), stored on the message and shown as
  "Reply cut short"; a truncated extraction reply that isn't JSON says so.
- **Streaming is project-level**: `src/chat/useChatStreams.ts` is mounted in `Workspace`, so streams survive switching tabs
  and several chats can stream at once. The renderer generates each `requestId` and routes stream events by it to
  `{ chatId, assistantId }`; the stream registry in main keys on the same id.
- **Search suggestions** (Gemini `searchEntryPoint.renderedContent`, an `extras` event) are sanitized and rendered in a
  contained shadow root (`SearchSuggestions.tsx`). No iframe, and the CSP is unchanged.
- **Test hooks**: `VRS_LLM_BASE_URL` redirects every provider call, so `testOverride.js` honours it only when the app is
  unpackaged and the value is a plain `http` loopback origin; anything else is ignored with a warning. E2E uses the fake
  provider (`e2e/fakeProvider.ts`) with the `aiTest` fixture (`e2e/electron-launch.ts`), which points the app at it.

## AI Extraction

On demand, AI reads chosen sources (imported chats, AI Chats, documents) and proposes facts and new cards. AI-only:
the Extract button (and "Extract facts…" in a source's binder row menu, `ContextMenu`), the Review mode, "This is my own writing" and the card's Rejected list are hidden while AI is off.

- **`llm:extract`** (`llmService.extract`, cancelled by `llm:extract-cancel` and `abortAll()`, respects `abortEpoch`)
  streams one request with the provider's JSON-schema output on (`request.jsonSchema`: Gemini `responseJsonSchema`,
  Anthropic `output_config.format`, OpenAI `text.format`), collects the text and validates it
  (`electron/lib/llm/extractionSchema.js`: one schema for all three, every property required, no nulls). The renderer
  builds the text (`src/extraction/request.ts`); the schema never leaves main.
- **Sources** (`src/extraction/sourceText.ts`): turns from the canonical layout, else raw exporter headings found in
  place (`exporterTurnSpans`), else one turn with no role; AI Chat messages are turns with `messageId`. Quotes are
  located exactly, then whitespace-tolerantly, in the cited turn then the others; the stored quote is the source's own text.
- **Applying** (`src/extraction/apply.ts`) re-matches results against the current canon every time, and is idempotent:
  `said`/`built_on` on an existing entity become `proposed` facts (origin `"ai"`, `evidence[]`, `replaces?`) or merge
  evidence into a live fact that agrees; `suggested` and everything for an unknown entity wait in `extraction.json`.
  `said`/`built_on` without a writer-turn quote are downgraded; a source without turns is `suggested` unless `ownWriting`.
- **`bible/extraction.json`**: `{ rejections, runs, cards, pending }` (`src/extraction/types.ts`, `normalizeExtraction`),
  saved, recovered and watched like `bible.json`. Pruned on save (`pruneExtraction`).
- **Rejections**: a fact set aside by hand (no decision lists it in `setAsideIds`) is a rejection, derived, never stored;
  `extraction.json` stores only rejected cards and dismissed pending proposals. A value set aside by `keepOne` comes
  back only with new evidence. Fingerprint = entity id (or `new:<kind>:<title>`), attribute key, normalized value.
- **Run cache**: one per source, keyed by `cacheKey(source text, provider, model)` with `EXTRACTION_PROMPT_VERSION`
  (bump it when the prompt changes). Re-running an unchanged source makes no request.
- **Keep the newer** (`src/bible/newer.ts`, non-AI) suggests the version whose latest evidence is furthest down the
  source order; never automatic.
- **Semantic conflict check** (`llm:conflict-check` / `llm:conflict-check-cancel`, same rules as `llm:extract`; schema in
  `electron/lib/llm/conflictSchema.js`): "Check for conflicts" on a full card (that entity) or the card wall (the shown kind),
  AI only. `src/extraction/conflictCheck.ts` sends up to `MAX_CHECK_FACTS` live facts as refs (`F1`...) and maps the reply back;
  same-entity same-attribute pairs are left to exact contradictions. Flags (`extraction.json` `flags`, optional) are advisory and
  never change a fact; one shows only while both facts are live and unchanged (`pairFingerprint`). Dismissing is sticky
  (`dismissedFlags`, by value fingerprint). A re-check replaces earlier flags among the facts it sent. `useConflictCheck` in Workspace.

## Security Rules (non-negotiable)

- Windows use `secureWebPreferences()` (contextIsolation, sandbox, no nodeIntegration) and `applyNavigationGuards()`.
- CSP (`electron/lib/csp.js`) keeps `connect-src 'self'`. All network access (LLM providers included) goes
  through the main process, and API keys never reach the renderer.
- Every IPC handler that touches a path calls `validateProjectPath()` against the open project root.
- Disk writes use `atomicWriteFile()`.
- The preload exposes narrow, named functions. Never expose `ipcRenderer` itself. When the bridge changes,
  update `src/vite-env.d.ts` and the bridge-surface e2e test.
- Markdown from users or LLMs must be sanitized (DOMPurify) before it's rendered as HTML.
- `.env` is gitignored and must never be committed.

## Conventions

- `@/` import alias for renderer code (`src/`).
- Use theme-token utilities (`bg-surface`, `text-content`, `text-content-muted`, `border-line`, `text-accent`)
  rather than raw palette colors, so light and dark themes keep working.
- Main process logs through `electron/lib/logger.main.js`. `no-console` is enforced.
- Write tests first. Main-process logic goes in small, pure-ish modules under `electron/lib/` so it can be unit-tested.
- Commit locally. Ask the user before pushing to any remote.
