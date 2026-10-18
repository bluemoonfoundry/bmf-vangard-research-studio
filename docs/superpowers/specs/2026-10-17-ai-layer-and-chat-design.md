# Phase 4: Opt-in AI layer and chat — design

Issue: `vrs-063.5` (parent epic `vrs-063`). Blocks `vrs-063.6` (Phase 5: AI extraction to proposals).

## Intent

Writers use an AI chat inside a VRS project to **think out loud** about their story, **ask questions about their own
canon**, and **do general research**. The chat knows the project's kept story-bible facts and any binder documents the
writer attaches. With the writer's permission (per-chat toggles), it can search the web and read URLs using the
provider's own built-in tools, the way Google AI Studio's chat does.

The writer must be able to **switch provider and model at will**, per chat. Nothing in the design may lock VRS into
Google: transcripts, settings and canon context are VRS-owned formats; providers are adapters.

AI stays **strictly opt-in** (project rule in `CLAUDE.md`): every AI feature is hidden and inert until AI is enabled
in Settings with a working API key, and the main process refuses AI calls while it is disabled.

## Goals

1. Settings → AI: off by default; keys for **Gemini, Claude (Anthropic) and OpenAI**; a default provider + model.
2. A provider-neutral main-process LLM layer with three adapters shipping in this phase: stream, cancel, list models,
   test key, and declared capabilities (web search, URL reading, temperature).
3. A new **AI Chat** binder item that preserves every feature of the prototype's `ChatDocumentEditor` (listed below),
   plus: per-chat provider/model picker, per-chat search and URL-reading toggles, canon injection, attached documents,
   streaming with cancel, and source citations.
4. Transcripts stored as `chats/<id>.json`, saved, recovered and watched like the rest of the project.

## Non-goals (this phase)

- AI extraction of facts into proposals (Phase 5, `vrs-063.6`).
- Copy/paste "bring your own AI" mode (`vrs-063.9`, undecided).
- Our own search/fetch implementation (a separate search API). **Decided: use each provider's built-in tools only.**
- Local/offline models, and providers beyond the three.
- Sending images/audio to the model; tool use other than the providers' web search / URL reading.
- Automatic trimming of oversized requests (see §5: nothing is ever dropped silently).
- Saved custom persona presets (built-ins plus an editable per-chat prompt is enough for now).
- Automatic retrieval over the whole binder (the writer attaches documents explicitly — **decided**).

## Anti-goals (would be a failure even if it works)

- Any AI UI visible, or any network call to a provider possible, while AI is disabled.
- An API key reaching the renderer, a log, a project file, a recovery snapshot or an error message.
- Transcript or settings shapes that only make sense for one provider (e.g. storing Gemini `contents`/`parts`).
- A non-AI feature that breaks or degrades when AI is off.
- Web search or URL reading happening without that chat's toggle being on.
- Hard-coded model lists that go stale (the prototype's fake model names are the cautionary example).

## Constraints (from the codebase and `CLAUDE.md`)

- Electron main/preload/renderer split: `secureWebPreferences()`, sandboxed preload exposing narrow named functions on
  `window.vrs`; update `src/vite-env.d.ts` and the bridge-surface e2e test whenever the bridge changes.
- CSP keeps `connect-src 'self'`. **All provider HTTP happens in the main process.**
- IPC uses the existing `handle(channel, fn)` wrapper in `electron/main.js` (main-window sender check,
  `{ ok, value | error: { code, message } }` envelope); renderer unwraps via `src/project/api.ts` patterns.
- Disk writes via `atomicWriteFile()`; main-process logging via `logger.main.js` (`no-console`).
- Item ids become file names: validate with `isValidItemId()`. `chats/` is already in `PROJECT_DIRS`.
- Markdown from LLMs is sanitized (DOMPurify) before rendering (the existing `MarkdownView` does this).
- Pure logic in small tested modules (`electron/lib/*.js` with co-located tests; renderer pure modules alongside
  `src/bible/` style). Tests first. `npm run gate` before closing the issue.
- Theme tokens (`bg-surface`, `text-content`, …), `@/` import alias.

## Decisions made with the user

| Topic | Decision |
|---|---|
| Purpose | Think out loud, canon Q&A, general research. |
| Web access | Per-chat toggles, AI Studio-style: **Web search** and **Read URLs**, both **off by default**. |
| Search implementation | Each provider's **built-in** tools. No VRS-run search. |
| Provider lock-in | None allowed; provider and model switchable at will. |
| Model selection | **Per-chat picker**, with a **default in Settings**. |
| Providers this phase | **Gemini, Claude, OpenAI.** |
| Prototype features | **All preserved** (list below). |
| Canon | The chat sees **all kept facts**. |
| Documents | The chat can read binder documents the writer **attaches per chat**. |
| Leaving a chat mid-reply | Reply **keeps streaming in the background**; several chats may stream at once. |
| Fact capture | **Included now**: facts can be captured from AI Chat messages, with sources pointing at a message. |
| Gemini search display rule | **Comply**: store and show Google's search-suggestions snippet, as an optional provider-extras field. |

## Design

### 1. Settings → AI

New app-level settings (not per project), stored in `userData/settings.json` via a new `electron/lib/appSettings.js`
(atomic writes, unknown fields kept). AI portion:

```jsonc
{
  "ai": {
    "enabled": false,
    "defaultProvider": "gemini",        // provider id or null
    "defaultModel": "gemini-...",       // model id or null
    "providers": { "gemini": { "configured": true, "lastTestOk": "2026-10-17T..." }, ... }
  }
}
```

Keys live separately in `userData/ai-keys.json`, each value encrypted with Electron `safeStorage`
(`electron/lib/apiKeys.js`). Plain keys exist only in main-process memory while making a request.

- **Builder's call (mine):** if `safeStorage.isEncryptionAvailable()` is false, refuse to store keys and explain why
  in the settings UI, rather than fall back to plaintext.
- **Enabling:** the "Enable AI" switch is only accepted by main when at least one provider has a stored key whose most
  recent test succeeded. Adding a key runs a test call (a model-list request is enough); a failing key is not saved.
- **Disabling:** keys stay stored (inert) so re-enabling is one click; each provider row has **Remove key**.
- **Default model:** chosen from the live model list of a configured provider.
- The renderer only ever sees `{ enabled, defaultProvider, defaultModel, providers: { id: { configured, lastTestOk } } }`
  — never key material, not even masked fragments.

UI: a Settings dialog (VRS has none yet; add a gear entry point in the app chrome) with an **AI** section: master
switch, one row per provider (status, Add/Replace key → test, Remove key), default provider/model pickers. The rest of
the dialog can be just this section for now.

### 2. Main-process LLM layer

`electron/lib/llm/`:

- `providers/gemini.js`, `providers/anthropic.js`, `providers/openai.js`, each implementing:

  ```ts
  interface ProviderAdapter {
    id: 'gemini' | 'anthropic' | 'openai';
    listModels(key, signal): Promise<ModelInfo[]>;         // from the provider's models API; includes
                                                           // inputTokenLimit when the API reports it
    capabilities(modelId): { webSearch: boolean; readUrls: boolean; temperature: boolean };
    stream(request: ChatRequest, key, signal, onEvent): Promise<void>;
  }
  type StreamEvent =
    | { type: 'text'; delta: string }
    | { type: 'sources'; sources: Source[] }               // normalized; see below
    | { type: 'extras'; extras: ProviderExtras }           // provider-specific display data (Gemini search chip)
    | { type: 'done'; model: string; usage?: { inputTokens?: number; outputTokens?: number } }
    | { type: 'error'; code: string; message: string };
  ```

- A VRS-owned, provider-neutral `ChatRequest`:
  `{ provider, model, system: string, messages: { role: 'user'|'assistant', text }[], temperature?, webSearch, readUrls }`.
  Each adapter translates it to its own wire format (Gemini `contents`/`systemInstruction`, Anthropic Messages,
  OpenAI Responses or Chat Completions — builder's choice per provider).
- **Plain `fetch` over REST with SSE parsing, no vendor SDKs** (my call: fewer deps, one streaming parser, the issue
  already asks for Gemini over REST). A shared `sse.js` parser with tests.
- **Built-in web tools** (builder must verify current API names/versions against each provider's docs at build time):
  - Gemini: Google Search grounding tool + URL context tool; sources from grounding metadata. **Google's grounding
    terms require displaying the returned Search Suggestions** (`searchEntryPoint.renderedContent`, HTML/CSS) whenever
    an answer used Google Search; the builder must confirm the current requirement. Decided: comply. The adapter emits
    it as `{ type: 'extras', extras: { gemini: { searchEntryPointHtml } } }`; it is stored on the message (§4) and
    rendered in a sandboxed `<iframe sandbox srcdoc>` (no scripts, no same-origin; link clicks end up in the system
    browser via the existing window-open guard / `app:open-external`; builder to find the cleanest compliant wiring).
    It never goes through `MarkdownView` and is never sent back to any model.
  - Anthropic: server-side web search tool and web fetch tool; sources from citation/search-result blocks.
  - OpenAI: built-in web search tool (Responses API); sources from URL citation annotations. If no URL-reading tool
    exists, `readUrls` capability is false for OpenAI (search may still open pages on its own — that's fine).
- `capabilities(modelId)`: provider-level rules plus model-id patterns (models APIs rarely say which tools a model
  supports). If a provider rejects a tool or parameter at request time, surface a clear error on that message; don't
  silently drop the toggle. **Builder's call** on the exact rule tables; keep them in one place per adapter, tested.
- `Source` (normalized): `{ title?: string; url: string }`, http/https only, deduplicated by URL.
- Model lists are cached in main per provider for the session, refreshable from the picker.

`electron/lib/llm/llmService.js` owns: AI-enabled check, key lookup, active request registry (request id →
`AbortController`), and size validation of incoming requests (reject absurd payloads; my call: a generous cap such as a
few MB of text).

**IPC** (all through `handle()`; every `llm:*` handler throws `{ code: 'AI_DISABLED' }` while disabled — tested):

| Channel | Purpose |
|---|---|
| `settings:get-ai` / `settings:set-ai` | Read/write the non-secret AI settings (enable is validated as above). |
| `llm:save-key` (provider, key) | Test then store; returns provider status. Allowed while disabled (setup needs it). |
| `llm:remove-key` (provider) | Allowed while disabled. |
| `llm:test` (provider) | Re-test a stored key. Allowed while disabled. |
| `llm:list-models` (provider, { refresh }) | Refused while disabled. |
| `llm:chat-start` (ChatRequest) → `requestId` | Starts streaming; refused while disabled. |
| `llm:chat-cancel` (requestId) | Aborts. |
| event `llm:chat-event` `{ requestId, event }` | Main → renderer stream events (subscribed via preload `subscribe`). |
| `llm:cancel-all` | Aborts every in-flight request (project close). |

Key-management channels are the only `llm:*` ones exempt from the disabled check, since you can't enable AI without
them. Disabling AI aborts all in-flight requests. Errors carry provider HTTP status mapped to codes
(`AUTH`, `RATE_LIMIT`, `BAD_REQUEST`, `NETWORK`, `CANCELLED`, `PROVIDER`) with messages scrubbed of keys.

### 3. AI Chat binder item

- **New item type `ai-chat`** (display name "AI Chat"). Distinct from the existing `chat` type, which is an imported
  plain-text transcript in `docs/<id>.md` and stays unchanged.
- Offered in Add Item **only while AI is enabled**. Existing AI Chat items stay in the binder when AI is off and open as
  a **read-only transcript** with a "Turn on AI in Settings to continue this chat" notice (my call: they're research).
- `ChatEditor` is mounted with `key={item.id}` (fixes the prototype's leaked state across chats).
- The item's `docs/<id>.md` body is unused/empty; its content is the transcript.

### 4. Transcript file `chats/<id>.json`

```jsonc
{
  "version": 1,
  "settings": {
    "provider": "anthropic", "model": "…",
    "personaId": "general_assistant",      // or null for custom
    "systemPrompt": "…",
    "temperature": 0.7,                    // null = provider default
    "webSearch": false, "readUrls": false,
    "attachments": ["<itemId>", "…"],       // binder items (documents or folders)
    "filterMode": "all"                    // all | user_only | model_only
  },
  "messages": [
    { "id": "…", "role": "user", "text": "…", "createdAt": "…", "edited": false },
    { "id": "…", "role": "assistant", "text": "…", "createdAt": "…",
      "provider": "anthropic", "model": "…", "status": "complete",   // complete | cancelled | error
      "error": null, "sources": [{ "title": "…", "url": "https://…" }],
      "usedWebSearch": true, "usedReadUrls": false,
      "providerExtras": { "gemini": { "searchEntryPointHtml": "…" } } }   // optional, display-only
  ]
}
```

Unknown fields are kept (match `bible.json`'s policy). A missing/corrupt file opens as an empty chat with a notice, and
the corrupt file is not overwritten until the user changes the chat (my call).

Persistence integration (follow the patterns for `bible/bible.json`):

- Loaded on project open with everything else (search needs them).
- Save payload gains chat transcripts for dirty chats; **save order** becomes docs, chats, `tree.json`,
  `bible/bible.json`, `vrs.json`, then deletions. Deleting an AI Chat item deletes `chats/<id>.json`.
- Recovery snapshots include dirty chats.
- `projectWatcher` / `useProject`'s external-change handler extend to `chats/` (content-hash filtering, reload clean,
  ask before replacing unsaved).
- **Streaming lives at project level, not in `ChatEditor`.** Decided: a reply keeps streaming when the writer opens
  another item or switches chats, and several chats can stream at once. A project-level stream manager (in or beside
  `useProject`) routes `llm:chat-event` by `requestId → { chatId, messageId }` and appends deltas into project state;
  `ChatEditor` only renders and issues commands. The pending assistant message is created at send time with
  `status: "streaming"`, which is never persisted as such: a save or recovery snapshot taken mid-stream writes the
  partial text as `status: "cancelled"`, and the later completion updates it and marks the chat dirty again (my call).
- While a chat is streaming, its edit/resubmit/delete actions are disabled and Stop is offered (my call: avoids racing
  deltas into a truncated transcript). Other chats stay fully usable.
- **Closing the project or quitting cancels all in-flight replies** (`llm:cancel-all`), keeping partial text as
  `cancelled`; the existing unsaved-changes prompt then covers them. Disabling AI also cancels them.
- The binder shows a small "replying…" indicator on chats that are streaming (my call).
- Workspace search includes AI chat message text; dossier export includes AI chats as transcripts (my call); word
  counts exclude them.
- No schema version bump needed if `ai-chat` items and `chats/*.json` are additive and older VRS shows unknown types
  as documents — **builder to confirm** against `projectSchema.js`; bump + migration step only if needed.

### 4a. Fact capture from AI Chat messages

Decided: in scope now (Phase 5 also needs sources that point at chat messages).

- `FactSource` gains an optional **`messageId`**: `{ itemId, messageId?, quote, start, end }`. With `messageId`, offsets
  are into that message's stored `text`; without it, behavior is unchanged (offsets into `docs/<id>.md`).
- `resolveSource` uses the message text when `messageId` is set: exact → relocated (first occurrence in that message)
  → missing; item deleted → `deleted`; message deleted → missing, with a "message was deleted" reason (or a new state;
  builder's call, shown consistently in the facts panel and conflict queue).
- `projectSchema.js` bible validation accepts the optional `messageId` string. Builder to confirm an older VRS wouldn't
  reject it on read (unknown fields are kept, so no schema bump is expected); bump with a migration step only if needed.
- **Capture UI**: reuse `CapturePopover` on user and assistant messages. Messages render as Markdown but offsets must be
  in stored text, so (my call) the selected text is located in the message's stored text (exact substring, first
  occurrence). If the selection crosses Markdown syntax and can't be found, the writer is told and offered a per-message
  **Show raw** toggle (plain `<pre>`, like imported chats) where capture always works.
- "Go to source" opens the AI Chat, scrolls to the message and highlights the range. Editing or deleting a cited message
  degrades the source to relocated/missing, as with documents; it is never blocked.

### 5. Chat UI — prototype features preserved

From `ChatDocumentEditor.tsx` in the prototype (`C:/Users/ghirp/Downloads/Test/scrivener-research-studio`):

- **Persona presets** that fill an editable system prompt, in a drawer. Ship the five prototype personas (Historical
  Scholar, Worldbuilding & Lore Architect, Crime & Mystery Plot Auditor, Dialogue & Dialect Stylist, General Research
  Assistant), **rewritten generically** — drop the Dover-1684 / "Dr. Julian Sterling" specifics (my call). Editing the
  prompt makes the persona "Custom". Selecting a persona no longer changes the model (the prototype's
  `recommendedModel` was Gemini-only; drop it — my call).
- **Temperature** slider per chat; hidden when the model's capability says it isn't supported.
- **Per-message actions:**
  - Copy (all messages).
  - Edit a user message → **Save text only** (no API call, marks `edited`) or **Save & resubmit**.
  - **Resubmit / regenerate** a user message: sends it with all prior messages using the chat's current
    provider/model, and **drops every message after it** (prototype semantics).
  - **Delete this message**.
  - **Delete all before** / **delete all after** this message, each with a confirm showing the count (use the app's
    `ConfirmDialog`, not `window.confirm`).
- **Filter view:** all / my messages only / AI only, with the "filter active: showing n of m" notice.
- Chat title editable in the header.
- Loading indicator and inline error notice; plus **Stop** to cancel a streaming reply (new).

New in VRS:

- **Provider/model picker** in the chat header listing only configured providers; models from `llm:list-models`.
  New chats start from Settings' default. If the saved model is no longer listed, show it as unavailable and ask the
  writer to pick another (don't silently switch).
- **Web search** and **Read URLs** toggles next to the picker, off by default, saved per chat, shown only when the
  current model supports them (disabled with a tooltip otherwise; the saved value is kept).
- Each assistant message shows its **provider · model** stamp and, if any, a **Sources** list (links open through
  `app:open-external`), plus Google's search-suggestions chip on Gemini answers that used search (§2).
- **Attached documents** panel: attach binder items via a picker (and drag from the binder if cheap); a folder means
  "all documents under it". Removing an attachment never touches the item. Attachments whose item was deleted are shown
  as missing and skipped.
- **Context size indicator**: approximate size (characters → rough token estimate) of system prompt + canon +
  attachments + history, so a large bible or attachment set isn't a silent cost. My call: when the provider's models
  API reports the model's input limit, the indicator becomes a warning as the estimate nears or exceeds it; sending is
  still allowed. **Nothing is trimmed automatically**, so "the chat sees all kept facts" stays true; an oversized
  request shows the provider's error on that message. Main's size cap only guards against absurd payloads.
- Streamed Markdown rendered through the sanitized `MarkdownView`.

### 6. Prompt assembly (renderer, pure module)

Built fresh **on every send** from current in-memory state (so unsaved edits and newly kept facts count) by a pure
`src/chat/buildChatRequest.ts`:

1. **System** = chat's system prompt + a fixed VRS preamble (you're inside a story research workspace; canon below is
   the writer's established facts; prefer canon over guesses; say when canon is silent) + **Canon** + **Attachments**.
2. **Canon** = all facts with status `kept`, grouped by entity: entity title and kind, then `attribute: value` lines;
   `when` facts rendered as story positions; event dependencies ("X comes after Y") included. Proposed and set-aside
   facts are excluded. My call: open contradictions among kept facts are listed as "unresolved: A or B" rather than
   hidden. Deterministic ordering (testable snapshots).
3. **Attachments** = for each attached text item (document, web clip, imported chat, entity notes): title, type, and
   body text, delimited clearly. Media items contribute title/synopsis only.
4. **Messages** = transcript up to the point being sent (all, or up to the resubmitted message), mapped to
   `user`/`assistant` text; errored/cancelled empty assistant messages are skipped.

The renderer sends the assembled `ChatRequest` to main; main adds the key and calls the provider. (The renderer holds
canon and docs, including unsaved edits; this keeps main simple. Main still validates shape and size.)

## Testing

- Unit (main, Node): `appSettings`, `apiKeys` (safeStorage mocked; key never returned), `sse` parser, each adapter's
  request translation and stream/source parsing against recorded fixtures (no live network), capability tables,
  `llmService` disabled-refusal for every `llm:*` channel, cancel/abort, error mapping and key scrubbing.
- Unit (renderer, jsdom): `buildChatRequest` canon/attachment snapshots; transcript reducer ops (edit, resubmit
  truncation, delete before/after, cancel keeps partial); ChatEditor behavior with a mocked `window.vrs.llm`.
- E2E (Playwright, real Electron): AI off → no AI UI anywhere; enable flow with a **stubbed provider** (main-process
  test hook or local fake server — builder's call, must never hit real providers in CI); create AI Chat, send, stream,
  stop, resubmit; switch to another item mid-stream and return to a finished reply; capture a fact from an AI message
  and follow its source; save/reopen round-trip of `chats/<id>.json`; external edit of a chat file; bridge-surface test
  updated.

## Left to the builder

- Exact provider endpoints, API versions, tool names and model-capability rules (verify against current docs).
- OpenAI Responses vs Chat Completions.
- Settings dialog layout and entry point placement; chat layout details within the prototype's feature set.
- Token estimate method (rough character-based is fine).
- Whether to split this into sub-issues (suggested order: settings + keys → LLM layer + Gemini → chat item + storage →
  project-level streaming + chat UI → fact capture from messages → Claude + OpenAI adapters → Gemini search chip → e2e).
