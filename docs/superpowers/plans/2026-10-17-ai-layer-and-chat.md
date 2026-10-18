# AI Layer and Chat Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the opt-in AI layer: Settings → AI with keys for Gemini, Claude and OpenAI; a provider-neutral
main-process LLM service; and an **AI Chat** binder item with per-chat model picker, web-search / URL-reading
toggles, canon + attached-document context, background streaming, every prototype chat feature, and fact capture
from messages.

**Architecture:** Main process owns settings (`userData/settings.json`), encrypted keys (`userData/ai-keys.json`)
and all provider HTTP (`electron/lib/llm/`), exposed through `settings:*` / `llm:*` IPC that refuses AI calls while
disabled. Transcripts are VRS-owned JSON in `chats/<id>.json`, held in the renderer reducer next to `docs` with the
same saved/current identity pattern as `tree`. Prompt assembly, transcript edits and stream folding are pure
TypeScript in `src/chat/`; a Workspace-level stream manager routes stream events to chats so replies keep running
when the writer navigates away.

**Tech Stack:** Electron 44 (`safeStorage`, global `fetch`), React 19, TypeScript, Vitest (projects `main` =
`electron/**/*.test.ts`, `renderer` = `src/**/*.test.{ts,tsx}`), Playwright Electron e2e, Tailwind 4 theme tokens,
lucide-react, DOMPurify, marked.

**Spec:** `docs/superpowers/specs/2026-10-17-ai-layer-and-chat-design.md`. Read it before any task; it is the source
of every behavior rule referenced below.

## Global Constraints

- **Repo/branch:** `Y:/working/BlueMoonFoundry/bmf-vangard-research-studio`, branch `feature/vrs-063.5-ai-chat`
  off `main`. Commit locally; **never push without asking the user**. Commit messages end with
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **AI strictly opt-in:** every AI UI element hidden while `enabled === false`; every `llm:*` channel except
  `llm:save-key`, `llm:remove-key`, `llm:test` throws code `AI_DISABLED` while disabled.
- **Keys:** never returned over IPC, never logged, never in a project file, recovery snapshot or error message.
  Error messages pass through `scrub()` (Task 2).
- **No vendor SDKs.** Plain `fetch` + the shared SSE parser. No new runtime dependencies.
- **CSP unchanged** (`connect-src 'self'`, `frame-src 'none'`). Provider HTTP only in main.
- **Provider ids:** exactly `'gemini' | 'anthropic' | 'openai'`. UI names: "Google Gemini", "Anthropic Claude",
  "OpenAI".
- **Item type:** `'ai-chat'`, display name **"AI Chat"**. The existing `'chat'` type is untouched.
- **Toggle labels:** "Web search", "Read URLs". Both default `false`.
- **Transcript file:** `chats/<id>.json`, `version: 1`, unknown fields preserved (spec §4).
- **Save order:** docs, chats, `tree.json`, `bible/bible.json`, `vrs.json`, then deletions (docs, chats, assets).
- IPC via the existing `handle()` wrapper in `electron/main.js`; renderer unwraps with `unwrap()` from
  `src/project/api.ts`. When the bridge changes, update `src/vite-env.d.ts`, `src/test/fakeBridge.ts` and
  `e2e/smoke/app-launch.spec.ts`.
- Main-process modules: 4-space indent, JSDoc types, `.js`, logging via `logger.main.js`. Renderer: `@/` imports,
  theme tokens, `btn*`/`input` classes from `@/components/workspace/ui`, `ConfirmDialog` (never `window.confirm`).
- Tests first in every task. `npm run gate` passes before the issue closes.
- **Provider wire formats** (endpoints, headers, tool names, event shapes) must be checked against each
  provider's current API docs at build time; the fixtures in Tasks 3–5 are recorded from those docs.

## Review Focus

1. **A key with surrounding whitespace or a newline pasted from a browser**: it's trimmed before testing and
   storing (Task 1 test `trims pasted keys`).
2. **A provider error body that echoes the key or the request URL with `?key=`** (Gemini puts the key in the URL
   if done naively): the key is sent as a header, and `scrub()` removes it from any message (Task 2 tests).
3. **Stream events arriving after the chat item was deleted, or after the project closed**: they're dropped
   without throwing or resurrecting the chat (Task 11 test `drops events for a chat that no longer exists`).
4. **Saving while a reply streams, then the reply finishing**: the file holds `cancelled` partial text, and the
   chat is dirty again with the complete text (Task 8 test `save mid-stream persists cancelled then re-dirties`).
5. **A chat whose saved model no longer appears in the provider's list, or whose provider key was removed**: it
   shows as unavailable and Send is disabled until a model is picked. It never silently switches (Task 12 test
   `unavailable model blocks send`).

---

### Task 1: App settings and encrypted key store (main)

**Files:**
- Create: `electron/lib/appSettings.js`, `electron/lib/appSettings.test.ts`
- Create: `electron/lib/apiKeys.js`, `electron/lib/apiKeys.test.ts`

**Interfaces:**
- Produces:
  - `PROVIDER_IDS = ['gemini', 'anthropic', 'openai']` (exported from `appSettings.js`).
  - `createAppSettings(filePath) → { read(): Promise<AppSettings>, update(fn: (s: AppSettings) => AppSettings): Promise<AppSettings> }`
    where `AppSettings = { ai: { enabled: boolean, defaultProvider: ProviderId|null, defaultModel: string|null,
    providers: Record<ProviderId, { lastTestOk: string|null }> }, [k]: unknown }`. Missing/corrupt file → defaults
    (`enabled: false`, nulls); unknown top-level and `ai` fields preserved; writes via `atomicWriteFile`.
  - `createApiKeyStore(filePath, safeStorage) → { available(): boolean, has(p): Promise<boolean>, get(p): Promise<string|null>, set(p, key): Promise<void>, remove(p): Promise<void> }`.
    File shape `{ [provider]: base64(safeStorage.encryptString(key)) }`. `set` throws code `UNAVAILABLE` when
    `!safeStorage.isEncryptionAvailable()`, and `INVALID` for an unknown provider or empty key. `set` trims the key.

- [ ] **Step 1: Write failing tests** in both test files (temp dir per test, as `recentProjects.test.ts` does; fake
  `safeStorage = { isEncryptionAvailable: () => true, encryptString: s => Buffer.from('enc:' + s), decryptString: b => b.toString().slice(4) }`):
  - `defaults when the file is missing` → `read()` equals `{ ai: { enabled: false, defaultProvider: null, defaultModel: null, providers: { gemini: { lastTestOk: null }, anthropic: { lastTestOk: null }, openai: { lastTestOk: null } } } }`.
  - `defaults when the file is corrupt JSON`.
  - `update persists and keeps unknown fields` (write `{ theme: 'dark', ai: { extra: 1 } }` first; after update both survive).
  - `round-trips a key`, `trims pasted keys` (`'  sk-1\n'` → `get` returns `'sk-1'`), `file never contains the plain key`
    (read raw file, `expect(raw).not.toContain('sk-1')`), `refuses when encryption is unavailable` (code `UNAVAILABLE`),
    `remove deletes only that provider`, `rejects unknown provider` (code `INVALID`).
- [ ] **Step 2: Run** `npx vitest run --project main electron/lib/appSettings.test.ts electron/lib/apiKeys.test.ts`. Expected: FAIL (modules missing).
- [ ] **Step 3: Implement** both modules. Use `ProjectFormatError` style: `Object.assign(new Error(msg), { code })`.
- [ ] **Step 4: Run the same command.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(ai): app settings and encrypted API key store (vrs-063.5)`.

### Task 2: LLM HTTP helpers, SSE parser, errors

**Files:**
- Create: `electron/lib/llm/http.js`, `electron/lib/llm/http.test.ts`
- Create: `electron/lib/llm/sse.js`, `electron/lib/llm/sse.test.ts`

**Interfaces:**
- Produces:
  - `class LlmError extends Error { code }` with codes `AUTH | RATE_LIMIT | BAD_REQUEST | NETWORK | CANCELLED | PROVIDER | AI_DISABLED | INVALID | UNAVAILABLE`.
  - `mapHttpStatus(status: number) → code`: 401/403 → `AUTH`, 429 → `RATE_LIMIT`, 400/404/413/422 → `BAD_REQUEST`, other → `PROVIDER`.
  - `scrub(text: string, secrets: string[]) → string`: replaces each non-empty secret with `[redacted]`, and also strips any `key=` query value.
  - `requestJson(url, { method?, headers, body?, signal, fetchFn, secrets }) → Promise<any>`
    and `requestStream(url, { headers, body, signal, fetchFn, secrets }) → Promise<ReadableStream<Uint8Array>>`.
    Non-2xx → `LlmError(mapHttpStatus(status), scrub(providerMessage))`, where providerMessage is taken from JSON
    `error.message` when present, else the status text. Abort → `CANCELLED`. A fetch TypeError → `NETWORK`.
  - `async function* readSse(stream) → AsyncGenerator<{ event: string|null, data: string }>`: handles CRLF,
    multi-line `data:`, comments (`:`), chunk boundaries splitting lines and multi-byte UTF-8.

- [ ] **Step 1: Write failing tests:**
  - sse: `parses events split across chunks` (feed `'data: {"a"'`, `':1}\n\n'` → one `{event:null,data:'{"a":1}'}`);
    `joins multi-line data with \n`; `reads event names`; `ignores comments`; `handles CRLF`; `decodes a UTF-8 char split across chunks` (`'é'` bytes split).
  - http: `maps 401 to AUTH`, `maps 429 to RATE_LIMIT`, `uses the provider's error.message`,
    `scrubs the key from error messages` (fake fetch returns 400 with body `{"error":{"message":"bad key sk-SECRET"}}`, secrets `['sk-SECRET']` → message lacks it),
    `strips key= query values`, `abort becomes CANCELLED`, `fetch TypeError becomes NETWORK`.
- [ ] **Step 2: Run** `npx vitest run --project main electron/lib/llm`. Expected: FAIL.
- [ ] **Step 3: Implement.** `readSse` uses `TextDecoder` with `{ stream: true }` over `stream.getReader()`.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(ai): SSE parser and provider HTTP helpers (vrs-063.5)`.

### Task 3: Gemini adapter

**Files:**
- Create: `electron/lib/llm/providers/gemini.js`, `electron/lib/llm/providers/gemini.test.ts`
- Create: `electron/lib/llm/providers/fixtures/gemini-*.txt` (recorded SSE bodies: plain text, grounded with search, error)

**Interfaces:**
- Consumes: Task 2 helpers.
- Produces (all three adapters share this shape; Tasks 4–5 copy it):
  ```ts
  createGeminiAdapter({ baseUrl = 'https://generativelanguage.googleapis.com', fetchFn = fetch }) → {
    id: 'gemini';
    listModels(key, signal): Promise<ModelInfo[]>;   // ModelInfo = { id, name, inputTokenLimit?: number, capabilities: Capabilities }
    capabilities(modelId): Capabilities;            // { webSearch: boolean, readUrls: boolean, temperature: boolean }
    stream(request: ChatRequest, key, signal, onEvent: (e: StreamEvent) => void): Promise<void>;
  }
  ChatRequest = { provider, model, system: string, messages: { role: 'user'|'assistant', text: string }[],
                  temperature: number|null, webSearch: boolean, readUrls: boolean }
  StreamEvent = { type: 'text', delta } | { type: 'sources', sources: { title?: string, url: string }[] }
              | { type: 'extras', extras: { gemini: { searchEntryPointHtml: string } } }
              | { type: 'done', model: string, usage?: { inputTokens?: number, outputTokens?: number } }
  ```
  `stream` resolves after emitting `done`; failures **throw** `LlmError` (the service turns throws into `error` events).
- Rules: key sent as `x-goog-api-key` header, never in the URL. Models listed from `GET /v1beta/models` (paginate
  `pageToken`), keeping only those whose `supportedGenerationMethods` includes `generateContent`, ids without the
  `models/` prefix, `inputTokenLimit` copied. Streaming via `POST /v1beta/models/{model}:streamGenerateContent?alt=sse`.
  `system` → `systemInstruction`, `assistant` → role `model`. `webSearch` → `{ google_search: {} }` tool, `readUrls` →
  `{ url_context: {} }` tool. Sources from `groundingMetadata.groundingChunks[].web` (`uri`, `title`), deduped by URL,
  http/https only. `searchEntryPoint.renderedContent` → one `extras` event. `temperature` only when non-null.
  `capabilities`: `webSearch`/`readUrls` true for ids starting `gemini-2` or later major versions, else false;
  `temperature` always true. Keep the rule table at the top of the file.

- [ ] **Step 1: Write failing tests** with a fake `fetchFn` that records the request and returns fixture bodies:
  - `sends the key as a header, not in the URL` (`url` lacks `key=`; header `x-goog-api-key` equals key).
  - `translates system, roles and temperature` (asserts request JSON: `systemInstruction.parts[0].text`, roles `['user','model']`, `generationConfig.temperature === 0.4`; omitted when null).
  - `adds tools only when toggled` (`tools` absent when both false; `[{google_search:{}}, {url_context:{}}]` when both true).
  - `streams text deltas then done` (events `[text 'Hel', text 'lo', done{model}]` from `gemini-text.txt`).
  - `emits deduped http(s) sources and the search entry point` (from `gemini-grounded.txt`).
  - `lists generateContent models across pages without the models/ prefix`.
  - `throws AUTH on 403`.
- [ ] **Step 2: Run** `npx vitest run --project main electron/lib/llm/providers/gemini.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(ai): Gemini provider adapter (vrs-063.5)`.

### Task 4: Anthropic adapter

**Files:**
- Create: `electron/lib/llm/providers/anthropic.js`, `anthropic.test.ts`, `fixtures/anthropic-*.txt`

**Interfaces:**
- Consumes/Produces: the Task 3 adapter shape with `id: 'anthropic'`, `createAnthropicAdapter({ baseUrl = 'https://api.anthropic.com', fetchFn })`.
- Rules: headers `x-api-key`, `anthropic-version: 2023-06-01` (plus any `anthropic-beta` header the web-fetch tool
  requires, per current docs). `GET /v1/models` (paginate `after_id`/`has_more`); `inputTokenLimit` when the response
  provides it. `POST /v1/messages` with `stream: true`, `system`, `max_tokens` (constant `MAX_OUTPUT_TOKENS = 8192`),
  `messages` mapped 1:1. `webSearch` → the server web-search tool, `readUrls` → the server web-fetch tool (current
  versioned type names from the docs; keep them as constants). Text from `content_block_delta` / `text_delta`.
  Sources from `web_search_tool_result` blocks and text-block `citations` (`url`, `title`), deduped. `done.model`
  from `message_start.message.model`; usage from `message_delta.usage`. An SSE `error` event → throw
  `LlmError('PROVIDER', message)`. `capabilities`: web tools true for models the docs list as supporting them
  (pattern table at the top of the file), `temperature` true.

- [ ] **Step 1: Write failing tests:** `sends x-api-key and anthropic-version`, `maps system and messages`,
  `adds web search / web fetch tools only when toggled`, `streams text deltas then done with model and usage`,
  `collects sources from search results and citations`, `throws PROVIDER on an SSE error event`, `lists models across pages`, `throws AUTH on 401`.
- [ ] **Step 2: Run** `npx vitest run --project main electron/lib/llm/providers/anthropic.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(ai): Anthropic provider adapter (vrs-063.5)`.

### Task 5: OpenAI adapter

**Files:**
- Create: `electron/lib/llm/providers/openai.js`, `openai.test.ts`, `fixtures/openai-*.txt`

**Interfaces:**
- Consumes/Produces: Task 3 shape, `id: 'openai'`, `createOpenAiAdapter({ baseUrl = 'https://api.openai.com', fetchFn })`.
- Rules: **Responses API** (`POST /v1/responses`, `stream: true`), header `Authorization: Bearer <key>`. `system` →
  `instructions`; messages → `input` items with roles `user`/`assistant`. `webSearch` → the built-in web search
  tool. `capabilities.readUrls` is **false** for every model (no URL-reading tool). Text from
  `response.output_text.delta`; sources from `url_citation` annotations (`url`, `title`) on
  `response.output_text.annotation.added` and/or the completed output; `done` on `response.completed` (model and
  usage from it); `response.failed` / `error` → throw `PROVIDER`. `GET /v1/models`, filtered to chat-capable families
  (pattern table); no `inputTokenLimit`. `capabilities.temperature` false for reasoning-model patterns (`o\d`, `gpt-5`
  reasoning variants per current docs), else true; when false, `temperature` is never sent.

- [ ] **Step 1: Write failing tests:** `sends a bearer token`, `maps instructions and input`, `adds web search only when toggled`,
  `never sends temperature to models without it`, `readUrls capability is always false`, `streams deltas then done`,
  `collects url_citation sources`, `throws PROVIDER on response.failed`.
- [ ] **Step 2: Run** `npx vitest run --project main electron/lib/llm/providers/openai.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(ai): OpenAI provider adapter (vrs-063.5)`.

### Task 6: LLM service, IPC and bridge

**Files:**
- Create: `electron/lib/llm/llmService.js`, `electron/lib/llm/llmService.test.ts`
- Modify: `electron/main.js` (create service in `app.whenReady`, register handlers, call `llm.cancelAll()` in the
  `project:close` handler and the window `closed` handler)
- Modify: `electron/preload.js` (new `ai` namespace), `src/vite-env.d.ts`
- Create: `src/ai/types.ts`, `src/ai/aiApi.ts`, `src/ai/aiApi.test.ts`
- Modify: `src/test/fakeBridge.ts` (fake `ai` namespace), `e2e/smoke/app-launch.spec.ts` (bridge surface)

**Interfaces:**
- Consumes: Tasks 1–5.
- Produces:
  - `createLlmService({ settings, keys, adapters: Record<ProviderId, Adapter>, emit: (requestId, event) => void, now? })` →
    `{ getStatus(), setSettings(patch), saveKey(provider, key), removeKey(provider), testKey(provider), listModels(provider, { refresh }), startChat(requestId, request), cancel(requestId), cancelAll() }`.
  - `AiStatus = { enabled, defaultProvider, defaultModel, encryptionAvailable, providers: Record<ProviderId, { configured: boolean, lastTestOk: string|null }> }`. No key material.
  - Rules: `saveKey` runs `listModels` with the new key first and stores it only on success (sets `lastTestOk`);
    failure throws that error and stores nothing. `setSettings({ enabled: true })` throws `INVALID` unless some
    provider is configured with `lastTestOk`. `setSettings({ enabled: false })` calls `cancelAll()`.
    `removeKey` of the last configured provider also sets `enabled: false`. `startChat` validates `requestId`
    (`isValidItemId`), the request shape, provider configured, total text ≤ `MAX_REQUEST_CHARS = 4_000_000`
    (`INVALID` otherwise), and returns immediately; streaming runs in the background emitting events via `emit`.
    A thrown `LlmError` is emitted as `{ type: 'error', code, message }` (message scrubbed with the key). Cancel
    emits `{ type: 'error', code: 'CANCELLED', message: 'Cancelled' }`. Model lists are cached per provider until
    `refresh` or `saveKey`/`removeKey`.
  - Test-only override: when `process.env.VRS_LLM_BASE_URL` is set, main passes it as `baseUrl` to all three
    adapters (used by e2e, like `VRS_USER_DATA_DIR`).
  - IPC channels (spec §2 table): `settings:get-ai`, `settings:set-ai`, `llm:save-key`, `llm:remove-key`, `llm:test`,
    `llm:list-models`, `llm:chat-start(requestId, request)`, `llm:chat-cancel(requestId)`, `llm:cancel-all`, event
    `llm:chat-event` `{ requestId, event }`.
  - Preload `vrs.ai = { getSettings, setSettings, saveKey, removeKey, testKey, listModels, startChat, cancelChat, cancelAll, onChatEvent }`.
  - `src/ai/types.ts`: `ProviderId`, `PROVIDERS: { id, name }[]` (names per Global Constraints), `AiStatus`,
    `ModelInfo`, `Capabilities`, `ChatRequest`, `Source`, `ProviderExtras`, `StreamEvent` (adds the `error` variant).
  - `src/ai/aiApi.ts`: `createAiApi(bridge: VrsApi): AiApi` (each method unwrapped; `onChatEvent` passed through).

- [ ] **Step 1: Write failing tests** (`llmService.test.ts`, with fake settings/keys/adapters):
  - `refuses every llm channel while disabled` (`listModels`, `startChat`, `cancel`, `cancelAll` reject with `AI_DISABLED`; `saveKey`/`removeKey`/`testKey` allowed).
  - `saveKey stores only after a successful test`; `failed test stores nothing and rethrows AUTH`.
  - `cannot enable without a tested provider`; `disabling cancels in-flight chats` (an adapter that waits on its signal → emits `CANCELLED`).
  - `status never includes key material` (`JSON.stringify(status)` lacks the key).
  - `streams adapter events to emit in order`; `adapter throw becomes a scrubbed error event`; `rejects oversized requests`; `rejects an invalid requestId`.
  - `aiApi.test.ts`: `unwraps ok results and throws ProjectError on failure`.
- [ ] **Step 2: Run** `npx vitest run --project main electron/lib/llm/llmService.test.ts && npx vitest run --project renderer src/ai`. Expected: FAIL.
- [ ] **Step 3: Implement** service, IPC wiring, preload, types, `aiApi`, fake bridge (`fake.ai` state: `status`, `models`, `startedChats`, `emitChatEvent(requestId, event)`).
- [ ] **Step 4: Run** the Step 2 command, then `npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Update** the expected surface in `e2e/smoke/app-launch.spec.ts` to include
  `ai: ['cancelAll','cancelChat','getSettings','listModels','onChatEvent','removeKey','saveKey','setSettings','startChat','testKey']`.
- [ ] **Step 6: Commit** `feat(ai): LLM service, IPC channels and preload bridge (vrs-063.5)`.

### Task 7: Settings dialog (renderer)

**Files:**
- Create: `src/ai/useAi.ts`, `src/ai/useAi.test.ts`
- Create: `src/components/settings/SettingsDialog.tsx`, `src/components/settings/SettingsDialog.test.tsx`
- Modify: `src/App.tsx` (create `aiApi`, `useAi`, gear button "Settings" in header always visible, pass `ai` to `Workspace`)

**Interfaces:**
- Consumes: Task 6 `AiApi`, `AiStatus`, `ModelInfo`.
- Produces: `useAi(api: AiApi | null) → AiController = { status: AiStatus | null, enabled: boolean, refresh(), setSettings(patch), saveKey(p, key), removeKey(p), testKey(p), models(p): ModelInfo[] | undefined, loadModels(p, refresh?): Promise<ModelInfo[]>, error: string | null }`.
  `enabled` is `status?.enabled === true`. Models cached in the hook per provider.
  `SettingsDialog({ ai: AiController, onClose })` using `Modal`.
- UI (spec §1): master switch "Enable AI features" (disabled with hint "Add and test an API key first" until a provider
  has `lastTestOk`); one row per provider: status ("Not set" / "Key saved · tested <date>"), password input + "Save
  & test", "Test again", "Remove key"; when `encryptionAvailable` is false, inputs are disabled with "This system has
  no secure key storage, so VRS can't store API keys." Default provider/model selects (configured providers only;
  models from `loadModels`).

- [ ] **Step 1: Write failing tests:** `enable switch is disabled until a provider is tested`; `save & test calls saveKey with the typed key and clears the input`;
  `shows the provider error when the test fails`; `remove key asks for confirmation`; `default model list comes from the provider`;
  `no key input when secure storage is unavailable`; `useAi: enabled is false while status loads`.
- [ ] **Step 2: Run** `npx vitest run --project renderer src/ai src/components/settings`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(ai): Settings dialog with provider keys and defaults (vrs-063.5)`.

### Task 8: Transcript model and pure operations

**Files:**
- Create: `src/chat/types.ts`, `src/chat/personas.ts`, `src/chat/transcript.ts`, `src/chat/transcript.test.ts`

**Interfaces:**
- Consumes: `Source`, `ProviderExtras`, `StreamEvent`, `ProviderId` from `src/ai/types.ts`.
- Produces:
  - Types: `ChatFilterMode = 'all'|'user_only'|'model_only'`; `ChatSettings` and `ChatMessage` exactly as the spec §4
    JSON (`status?: 'streaming'|'complete'|'cancelled'|'error'`, `error?: { code, message } | null`); `ChatTranscript = { version: 1, settings, messages, [k: string]: unknown }`.
  - `CHAT_PERSONAS: { id, name, description, systemPrompt }[]`: the five prototype personas (ids
    `historical_scholar`, `worldbuilding_architect`, `detective_consultant`, `linguistic_stylist`,
    `general_assistant`), prompts rewritten generically (no Dover/1684/"Dr. Julian Sterling"), and
    `DEFAULT_PERSONA_ID = 'general_assistant'`.
  - `newTranscript(defaults: { provider: ProviderId|null, model: string|null }): ChatTranscript` (persona default, `temperature: null`, toggles false, `attachments: []`, `filterMode: 'all'`).
  - `normalizeTranscript(raw: unknown): ChatTranscript` (fills missing settings with defaults, keeps unknown fields; never throws on well-formed main-validated input).
  - `beginSend(t, { text, userId, assistantId, at, caps }): ChatTranscript` (`caps: Capabilities` of the chat's current model) appends the user message plus a pending assistant message (`status: 'streaming'`, `text: ''`, `provider`/`model` from settings, `usedWebSearch`/`usedReadUrls` = toggle && capability).
  - `beginResubmit(t, { messageId, text?, assistantId, at, caps }): ChatTranscript`: keeps messages before `messageId`, replaces that user message's text (sets `edited: true` if `text` differs), drops everything after, appends the pending assistant message.
  - `applyStreamEvent(t, assistantId, e: StreamEvent): ChatTranscript`: `text` appends; `sources` merges deduped by URL; `extras` sets `providerExtras`; `done` → `status: 'complete'`, `model` = `e.model`; `error` with `CANCELLED` → `'cancelled'`, other → `'error'` + `error`. Unknown `assistantId` → returns `t` unchanged.
  - `editMessageText(t, id, text)`, `deleteMessage(t, id)`, `deleteBefore(t, id)`, `deleteAfter(t, id)`, `updateSettings(t, patch)`.
  - `forPersistence(t): ChatTranscript` returns `t` itself (same reference) when nothing is streaming; otherwise a copy with `streaming` → `cancelled`.
  - `isStreaming(t): boolean`; `transcriptPlainText(t): string` (`"You: …\n\nAI (<model>): …"` blocks, for search/export).
  - `locateQuote(text: string, quote: string): { start: number, end: number } | null` (first exact occurrence).

- [ ] **Step 1: Write failing tests** covering each function, including:
  - `resubmit drops every later message` (5 messages, resubmit #3 → 3 + pending).
  - `edit-and-resubmit marks edited only when the text changed`.
  - `deleteBefore/After keep the pivot message`.
  - `stream events fold into the pending message; done stamps the model`.
  - `cancelled error keeps partial text`.
  - `events for an unknown message are ignored`.
  - `forPersistence returns the same object when idle and converts streaming to cancelled otherwise`.
  - `toggles are recorded only when the model supports them`.
  - `personas contain no prototype-project specifics` (`/Dover|1684|Sterling/` absent).
- [ ] **Step 2: Run** `npx vitest run --project renderer src/chat/transcript.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** All functions return new objects. Never mutate.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(chat): transcript model, personas and pure operations (vrs-063.5)`.

### Task 9: Transcript storage (main)

**Files:**
- Modify: `electron/lib/projectSchema.js` (+ tests): `CHATS_DIR = 'chats'`, `normalizeChat(raw)`, `validateSavePayload` accepts `chats`
- Modify: `electron/lib/projectStore.js` (+ tests): `readChat(root, id)`, save order and chat deletions
- Modify: `electron/lib/projectSession.js` (+ tests): `readChat(id)`
- Modify: `electron/main.js`, `electron/preload.js`, `src/vite-env.d.ts`, `src/project/api.ts`, `src/project/types.ts`, `src/test/fakeBridge.ts`, `e2e/smoke/app-launch.spec.ts`

**Interfaces:**
- Produces:
  - `normalizeChat(raw)`: throws `ProjectFormatError('CORRUPT', …)` unless a plain object with `version` a positive
    integer, `settings` a plain object, `messages` an array of plain objects each with string `id` (`isValidItemId`),
    `role` in `user|assistant`, string `text`. A `version` greater than 1 → `TOO_NEW`. Unknown fields kept.
  - `SavePayload.chats?: Record<string, ChatTranscript | null>` (null deletes). `validateSavePayload` checks ids
    with `isValidItemId` and each non-null value with `normalizeChat` (`INVALID` on failure).
  - `readChat(root, id) → Promise<{ transcript: object | null, problem: string | null }>`: missing file →
    `{ transcript: null, problem: null }`; invalid JSON or `normalizeChat` failure → `{ transcript: null, problem: <message> }`.
  - `saveProject` writes `chats/<id>.json` (pretty JSON + `\n`, via the existing `write` so the watcher sees it)
    after docs and before `tree.json`; deletes null chats after the manifest, alongside doc deletions.
  - IPC `project:read-chat(id)`, preload `project.readChat`, `ProjectApi.readChat`.

- [ ] **Step 1: Write failing tests:**
  - schema: `accepts a minimal transcript and keeps unknown fields`, `rejects a message with a bad role`, `rejects version 2 as TOO_NEW`, `validateSavePayload rejects an invalid chat id`.
  - store: `writes chats before tree.json` (record `onWrite` order: `docs/a.md`, `chats/c.json`, `tree.json`, `vrs.json`), `deletes a chat file on null`,
    `readChat: missing → null without problem`, `readChat: corrupt → problem message`, `readChat rejects an invalid id`.
- [ ] **Step 2: Run** `npx vitest run --project main electron/lib/projectSchema.test.ts electron/lib/projectStore.test.ts electron/lib/projectSession.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** (+ bridge, types, fake bridge `disk.chats`, bridge-surface list gains `readChat`).
- [ ] **Step 4: Run** the Step 2 command and `npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(chat): store AI chat transcripts in chats/<id>.json (vrs-063.5)`.

### Task 10: Transcripts in project state

**Files:**
- Modify: `src/project/projectState.ts`, `src/project/projectState.test.ts`
- Modify: `src/project/useProject.ts`, `src/project/useProject.test.ts`

**Interfaces:**
- Consumes: Task 8 (`ChatTranscript`, `forPersistence`, `newTranscript`, `normalizeTranscript`), Task 9 (`readChat`).
- Produces:
  - `ProjectState` gains `chats: Record<string, ChatEntry>` (`ChatEntry = { saved: ChatTranscript | null; current: ChatTranscript; problem?: string }`) and `deletedChats: string[]`.
  - Actions: `{ type: 'chatsLoaded'; chats: Record<string, { transcript: ChatTranscript | null; problem: string | null }> }`
    (null transcript → `current = saved = newTranscript(defaults)` so it's clean; `problem` kept for a notice),
    `{ type: 'chatUpdated'; id; update: (t) => t }`, `{ type: 'chatReloaded'; id; transcript }`, `{ type: 'chatDiskChanged'; id; transcript }`.
    `itemsAdded` gains optional `chats: Record<string, ChatTranscript>` (new entries with `saved: null`).
  - `itemDeleted` moves removed `ai-chat` ids into `deletedChats` (when `saved !== null` or not loaded) and drops their entries.
  - `isChatDirty(state, id) = entry.current !== entry.saved`; `isDirty` includes chats and `deletedChats`.
  - `buildSavePayload` adds `chats` = `forPersistence(current)` for dirty entries and `null` for `deletedChats`.
  - `saved` sets each written chat's `saved` to **the payload object** (so a reply that continued after the payload
    was built leaves the chat dirty). `recoveryRestored` restores `snapshot.chats` (with `diskChats`). `structureReloaded`
    drops entries whose item vanished.
  - `useProject`: `loadAllChats()` (reads every `ai-chat` item without an entry), `updateChat(id, update)`,
    `addItem(fields, content?, chat?)`, `duplicateItem` copies transcripts (new message ids not needed), recovery
    restore reads disk chats, external-change handling for `chats/<id>.json` mirroring docs (reload clean, conflict if dirty;
    `reloadFromDisk`/`keepMine` accept chat paths). `chatDefaults` argument for `chatsLoaded` comes from a new
    `useProject` option `chatDefaults: () => { provider, model }`.

- [ ] **Step 1: Write failing tests:**
  - reducer: `a new chat is dirty until saved`, `save mid-stream persists cancelled then re-dirties` (update → build payload while streaming → `saved` → apply `done` → `isChatDirty` true, payload chat status `cancelled`),
    `an idle save leaves the chat clean`, `deleting an ai-chat item queues its file for deletion`, `a missing file loads clean`, `recovery restores chats`.
  - hook: `loadAllChats reads only ai-chat items`, `external change reloads a clean chat`, `external change on a dirty chat raises a conflict`.
- [ ] **Step 2: Run** `npx vitest run --project renderer src/project`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS (existing tests included).
- [ ] **Step 5: Commit** `feat(chat): hold AI chat transcripts in project state (vrs-063.5)`.

### Task 11: Prompt assembly and background stream manager

**Files:**
- Create: `src/chat/buildChatRequest.ts`, `src/chat/buildChatRequest.test.ts`
- Create: `src/chat/useChatStreams.ts`, `src/chat/useChatStreams.test.ts`

**Interfaces:**
- Consumes: Tasks 6, 8, 10.
- Produces:
  - `VRS_PREAMBLE: string` (spec §6 item 1 wording).
  - `buildCanonText(items: TreeItem[], bible: Bible): string`: kept facts only, grouped by entity (entities sorted by
    title, then attribute), lines `- attribute: value`; `when` rendered `Season S, episode E, order O` (omitting
    absent parts); dependencies as `- comes after: <title>`; kept facts on the same entity+attribute with different
    values rendered once as `- attribute: unresolved: A or B`. Empty bible → `''`.
  - `buildAttachmentsText(ids: string[], items, contentOf): { text: string; missing: string[] }`: folders expand to
    descendant non-folder items in binder order; image/audio contribute title + synopsis; `ai-chat` items contribute
    `transcriptPlainText`; each block `### <title> (<type name>)\n<body>`; ids not in the tree go to `missing`.
  - `buildChatRequest({ transcript, uptoIndex, items, bible, contentOf, caps }): ChatRequest`: system = persona
    prompt + `VRS_PREAMBLE` + `## Canon` + `## Attached documents` sections (omitted when empty); messages = transcript
    messages `[0, uptoIndex)` minus assistant messages with status `error`/`streaming` or empty text; `webSearch`/
    `readUrls` = toggle && capability; `temperature` = setting when `caps.temperature`, else null.
  - `estimateTokens(req: ChatRequest): number = Math.ceil(totalChars / 4)`.
  - `capsOf(provider, model)` is built by Workspace from `AiController.models(provider)` (the model's `capabilities`,
    or all-false when the model isn't listed).
  - `useChatStreams({ ai: AiApi | null, project: ProjectController, capsOf(provider, model): Capabilities }) →
    { send(chatId, text): void, resubmit(chatId, messageId, text?): void, stop(chatId): void, streamingIds: ReadonlySet<string>, error: string | null }`.
    It generates `requestId`/`assistantId` with `crypto.randomUUID()`, applies `beginSend`/`beginResubmit` via
    `project.updateChat`, builds the request from **the latest state** (`project.state` via ref), calls
    `ai.startChat(requestId, request)`, and subscribes once to `onChatEvent`, routing `requestId → { chatId, assistantId }`
    into `applyStreamEvent`. Terminal events (`done`/`error`) remove the route. Events for an unknown route, or for a
    chat whose item no longer exists, are dropped. A rejected `startChat` applies an `error` event locally.
    Unmount calls `ai.cancelAll()`.

- [ ] **Step 1: Write failing tests:**
  - build: `canon includes only kept facts`, `canon renders when positions and dependencies`, `canon marks unresolved kept conflicts`,
    `folder attachment expands to its documents`, `deleted attachment is reported missing`, `resubmit history stops before the message`,
    `toggles are off when the model lacks the capability`, `temperature omitted when unsupported`, `deterministic output` (same input twice → equal strings).
  - streams (fake bridge + real `useProject`): `send creates a pending message and streams into it`, `keeps streaming after the editor unmounts`
    (render, send, unmount the editor only, emit events, assert transcript text), `two chats stream at once`,
    `stop cancels only that chat`, `drops events for a chat that no longer exists`, `startChat failure marks the message as error`.
- [ ] **Step 2: Run** `npx vitest run --project renderer src/chat`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(chat): prompt assembly with canon and attachments; background streams (vrs-063.5)`.

### Task 12: AI Chat item and ChatEditor UI

**Files:**
- Modify: `src/project/types.ts` (`ItemType` adds `'ai-chat'`), `src/workspace/research.ts` (`AI_CHAT_TYPE`, `addableItemTypes(aiEnabled)`), `src/components/workspace/ItemIcon.tsx`
- Modify: `src/components/workspace/AddItemModal.tsx` (prop `aiEnabled`), `src/components/workspace/Workspace.tsx`, `src/components/workspace/Binder.tsx` (search text + "replying…" indicator)
- Create: `src/components/chat/ChatEditor.tsx`, `ChatHeader.tsx`, `ChatMessageView.tsx`, `PersonaDrawer.tsx`, `AttachmentsPanel.tsx`, `ChatEditor.test.tsx`
- Modify: `src/components/workspace/ExportModal.tsx` callers (dossier text for ai-chat)

**Interfaces:**
- Consumes: Tasks 7, 8, 10, 11.
- Produces:
  - `Workspace` gains prop `ai: AiController`; `App` passes it. Workspace owns `useChatStreams` and a
    `textOf(id)` = `transcriptPlainText(chats[id].current)` for `ai-chat`, else `docs[id]?.current`, used for Binder
    search and `generateDossier`. Word counts keep using `docs`. The `ai-chat` body is always `''`.
  - `ChatEditor` props: `{ item, entry: ChatEntry | undefined, aiEnabled, configuredProviders: ProviderId[], models(p), loadModels(p, refresh?), capsOf, streaming: boolean,
    onUpdate(update), onRename(title), onSend(text), onResubmit(messageId, text?), onStop(), items, bible, contentOf, onOpenLink, capture?: CaptureWiring, highlight: { messageId, start, end } | null }`.
    Mount with `key={item.id}`.
  - Behaviour (spec §5): header with editable title, provider/model picker (configured providers only; a saved model not in
    the list shows "<model> (unavailable)" and disables Send), "Web search" / "Read URLs" toggles hidden when the chat's model lacks
    the capability, persona button opening `PersonaDrawer` (presets + editable system prompt; editing → `personaId: null`
    shown as "Custom"), temperature slider (0–2, step 0.1, "Default" reset to null) hidden without the capability, filter
    segment All / Mine / AI with the "Showing n of m" notice, attachments panel with picker (non-entity items and folders) and
    missing-item rows, context-size line `~N tokens` turning into a warning at ≥ 90% of `inputTokenLimit` when known.
    Messages: Markdown via `MarkdownView`; stamp `provider · model`; Sources list (links → `onOpenLink`); status badges
    for cancelled/error; actions Copy, Edit (user: Save text only / Save & resubmit), Resubmit (user), Delete, Delete all before,
    Delete all after (both through `ConfirmDialog` showing the count). While `streaming`: action buttons disabled, Stop shown.
    Composer: textarea, Enter sends, Shift+Enter newline.
  - `aiEnabled === false` → read-only transcript (no composer, picker, toggles or actions) with notice "Turn on AI in
    Settings to continue this chat." A loaded `entry.problem` shows "This chat file couldn't be read: <problem>".
  - AddItemModal lists "AI Chat" only when `aiEnabled`; creating one calls `addItem({ type: 'ai-chat', title }, '', newTranscript(defaults))`.

- [ ] **Step 1: Write failing tests** (`ChatEditor.test.tsx` + additions to `Workspace.test.tsx`):
  - `AI Chat is not offered while AI is off`, `existing AI chats open read-only while AI is off`.
  - `toggles hidden when the model lacks the capability`, `toggling Web search saves it on the chat`.
  - `unavailable model blocks send`.
  - `persona preset fills the prompt; editing makes it Custom`.
  - `edit → save text only does not call the provider`, `resubmit drops later messages without a confirm`, `delete all after asks for confirmation with the count`.
  - `filter shows only my messages with the n of m notice`.
  - `sources render as links that open externally`.
  - `actions disabled and Stop shown while streaming`.
  - `binder search finds text inside an AI chat`, `dossier export includes the transcript`.
- [ ] **Step 2: Run** `npx vitest run --project renderer src/components`. Expected: FAIL.
- [ ] **Step 3: Implement.** Keep each new component under ~250 lines; reuse `btn`, `segment`, `input` classes.
- [ ] **Step 4: Run** `npm test && npm run typecheck && npm run lint`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(chat): AI Chat binder item and chat editor (vrs-063.5)`.

### Task 13: Fact capture from AI messages

**Files:**
- Modify: `src/project/types.ts` (`FactSource.messageId?: string`), `electron/lib/projectSchema.js` (+ test: optional `messageId` must be a valid id when present)
- Modify: `src/bible/sources.ts` (+ `src/bible/bible.test.ts`), `src/components/bible/CapturePopover.tsx`, `EntityPanel.tsx`, `VersionCard.tsx`, `ConflictQueue.tsx`
- Modify: `src/components/chat/ChatMessageView.tsx`, `ChatEditor.tsx`, `src/components/workspace/Workspace.tsx`

**Interfaces:**
- Consumes: Tasks 8, 12; existing `CaptureHost`, `ChatView`.
- Produces:
  - `resolveSource(source, body: string | null | undefined, itemExists)`: `null` → `{ status: 'missing' }` (message deleted); otherwise unchanged.
  - `sourceText(source, bodyOf: (id) => string | undefined, chatOf: (id) => ChatTranscript | undefined): string | null | undefined`:
    no `messageId` → `bodyOf(itemId)`; with `messageId`: chat not loaded → `undefined`, message gone → `null`, else its `text`.
    `EntityPanel`, `VersionCard`, `ConflictQueue` take `chatOf` and resolve via `sourceText`.
  - `CaptureHost` gains optional `messageId`; the stored source includes it.
  - Capture in a rendered message: on selection inside a message, `locateQuote(message.text, selection.toString())`;
    found → open `CaptureHost` with `{ start, end, quote, messageId }`; not found → inline note "Couldn't match this
    selection to the message text. Use Show raw to capture." Each message has a **Show raw** toggle rendering
    `ChatView` (exact offsets).
  - `openSource` in Workspace: with `messageId`, navigate to the chat and set `highlight = { itemId, messageId, start, end }`;
    `ChatEditor` switches that message to raw view, scrolls it into view and marks the range via `ChatView.highlight`.
- [ ] **Step 1: Write failing tests:** `resolveSource: null body is missing`, `sourceText reads the cited message`, `sourceText: deleted message → null`,
  `schema rejects an invalid messageId`, `capturing from a rendered message stores messageId and exact offsets`,
  `selection across Markdown syntax suggests Show raw`, `opening a message source highlights it in raw view`.
- [ ] **Step 2: Run** `npx vitest run --project renderer src/bible src/components && npx vitest run --project main electron/lib/projectSchema.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(bible): capture facts from AI chat messages (vrs-063.5)`.

### Task 14: Gemini search suggestions chip

**Files:**
- Create: `src/chat/searchSuggestions.ts`, `src/chat/searchSuggestions.test.ts`
- Create: `src/components/chat/SearchSuggestions.tsx`, `src/components/chat/SearchSuggestions.test.tsx`
- Modify: `src/components/chat/ChatMessageView.tsx`

**Interfaces:**
- Consumes: `ChatMessage.providerExtras.gemini.searchEntryPointHtml` (Task 8).
- Produces:
  - `sanitizeSearchSuggestions(html: string): string`: DOMPurify with `ADD_TAGS: ['style']`, no scripts/handlers/iframes/forms; `href` kept only for http/https.
  - `SearchSuggestions({ html, onOpenLink })` renders the sanitized HTML into an **open shadow root** on a host `div`
    (styles stay scoped; no iframe, so `frame-src 'none'` stays). A click listener on the shadow root finds the closest
    `a[href]`, calls `preventDefault()` and `onOpenLink(href)`. Shown under a Gemini assistant message that has the extra.
    Never sent to any model (Task 11's `buildChatRequest` only sends `text`; covered by a test there already).
  - The builder confirms Google's current display requirement; if it no longer applies, keep the component, since it's harmless.
- [ ] **Step 1: Write failing tests:** `strips scripts and event handlers`, `keeps style tags`, `drops javascript: links`,
  `renders inside a shadow root`, `clicking a suggestion opens it externally and does not navigate`.
- [ ] **Step 2: Run** `npx vitest run --project renderer src/chat/searchSuggestions.test.ts src/components/chat/SearchSuggestions.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(chat): show Gemini search suggestions for grounded answers (vrs-063.5)`.

### Task 15: End-to-end coverage with a fake provider

**Files:**
- Create: `e2e/fakeProvider.ts` (local `http.createServer` on port 0 serving Gemini-shaped `GET /v1beta/models`
  and `POST …:streamGenerateContent` SSE; a configurable delay between chunks; a hook to hold the stream open until released)
- Create: `e2e/ai/ai-chat.spec.ts`
- Modify: `e2e/electron-launch.ts` (`launchEnv` passes `VRS_LLM_BASE_URL` when a test sets it; a `fakeProvider` fixture)

**Interfaces:**
- Consumes: everything above. Never contacts real providers: the fixture sets `VRS_LLM_BASE_URL` to the fake server
  for every AI spec.
- [ ] **Step 1: Write the specs** (each stubs dialogs per `CLAUDE.md`):
  - `no AI UI while AI is off` (Add Item lacks "AI Chat"; no model picker anywhere).
  - `enable flow`: Settings → paste key → Save & test → Enable → default model chosen from the fake list.
  - `chat round trip`: create AI Chat, send, see streamed reply with model stamp, save, reopen project, transcript intact and `chats/<id>.json` exists with `version: 1`.
  - `reply keeps streaming in the background`: hold the stream, open another item, release, return: reply complete, binder indicator gone.
  - `stop keeps partial text as cancelled`.
  - `capture a fact from an AI message and follow its source`.
  - `external edit of a chat file reloads a clean chat`.
  - `key never reaches the renderer` (`window.evaluate` over `JSON.stringify` of everything `vrs.ai.getSettings()` returns lacks the key).
- [ ] **Step 2: Run** `npm run test:e2e -- e2e/ai`. Expected: PASS (fix the app, not the test, for any failure).
- [ ] **Step 3: Run** `npm run gate`. Expected: PASS.
- [ ] **Step 4: Commit** `test(e2e): AI settings and chat flows against a fake provider (vrs-063.5)`.

### Task 16: Docs and issue wrap-up

**Files:**
- Modify: `CLAUDE.md` (new "AI layer" section: settings/keys files, `llm:*` refusal rule, adapters and capability tables,
  transcript format and save order, project-level streaming, `FactSource.messageId`, `VRS_LLM_BASE_URL` test hook)
- Modify: `README.md` if it lists features.

- [ ] **Step 1: Write the docs.**
- [ ] **Step 2: File follow-ups** with `bd create` for anything deferred (e.g. saved custom personas, drag-to-attach if skipped), linked under `vrs-063`.
- [ ] **Step 3: Run** `npm run gate`. Expected: PASS.
- [ ] **Step 4: Commit** `docs(ai): document the AI layer and chat (vrs-063.5)`, then `bd close vrs-063.5` once the user has reviewed the branch.
