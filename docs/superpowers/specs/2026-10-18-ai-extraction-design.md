# Phase 5: transcript import, card wall, and AI extraction to proposals

Issue: vrs-063.6. Builds on the story bible (`2026-10-17-story-bible-design.md`) and the AI layer
(`2026-10-17-ai-layer-and-chat-design.md`).

## Intent

The writer's worldbuilding lives in long AI chats, mostly Google AI Studio sessions, plus research
notes. In those chats the material is:

- **unsearchable**: AI Studio can't search a chat, so a surname from the top is lost by the bottom;
- **unmarked**: there's no way to tag what is canon and hide what no longer is;
- **bloated**: the same detail repeats many times, sometimes contradicting itself, mixed with
  brainstormed options that were never adopted.

What the writer wants is **condensed, at-a-glance cards** (dossiers) for characters, locations,
factions, lore and so on. They'll use these as the reference while writing the VN in Vangard Studio
(`bmf-vangard-renpy-ide`). Phase 5 gets the material out of the chats and into those cards with as
little manual work as possible. Nothing becomes canon without the writer's say-so.

## Goals

1. **Import** existing AI Studio chats into VRS as transcripts, several at a time, split into the
   writer's turns and the model's turns.
2. **Card wall**: a view of each entity kind (bin) as a wall of cards showing kept facts at a glance.
   Clicking a card opens a full-size view with facts, decisions, linked media and provenance.
3. **AI extraction**: on demand, read chosen transcripts and documents and propose condensed facts and
   new cards. Each proposal carries its evidence and how strong that evidence is, and goes into a
   review queue.
4. **Semantic conflict check**: on demand and bounded, ask the AI to flag facts that conflict in
   meaning, which exact-value comparison can't catch.

## Non-goals

- Writing scenes or prose dossiers. That's the writer's job, done in Vangard Studio.
- Scene timelines beyond what the existing timeline view does.
- Map Studio (Phase 6, vrs-063.7). Until then, maps are ordinary image items.
- Gemini consumer-app import (Takeout, share links), and scraping any web page.
- ChatGPT/Claude export import (vrs-063.13). The importer should be easy to extend to them later.
- Route-scoped canon (still out of scope, as in the bible design).

## Anti-goals (a failure even if it technically works)

- **Anything becoming canon automatically.** Extraction only ever creates `proposed` facts and
  proposed cards.
- **The card wall filling with brainstormed options the writer never adopted.** Most of a chat is
  the model offering alternatives, such as five possible forms of government, and only some become canon.
- **Rejected proposals coming back** on a re-run.
- **A flood of review work**: ten mentions of one detail must be one proposal, and a branched chat
  must not double the queue.
- **AI being required.** Import and the card wall are non-AI features and must work with AI disabled.
  Every extraction surface stays hidden and inert until AI is enabled (project rule).
- **A silent overwrite** of older canon by a newer chat.

## What exists today (build on it)

- Imported text transcripts: item type `'chat'`, body in `docs/<id>.md`, created by
  `ImportChatModal` (paste or one `.txt/.md` file via `project:import-text` / `textImport.js`,
  5 MB cap). Search, fact capture and `resolveSource` already work on them.
- Bible: `Fact { entityId, attribute, value, status, source?, origin, ... }` with status
  `proposed | kept | set_aside`. Contradictions are derived from proposed and kept facts.
  `keepOne`/`keepAll`/`reopen` decisions. The `EntityPanel` already shows pending, kept and set-aside facts.
- Entities are binder items (`type: 'entity'`, `entityKind` in `ENTITY_KINDS`: character, location,
  faction, item, lore, event, plotline). They already have `synopsis`, a body (notes), `references`
  (links to any binder item) and `keywords`.
- `eventsLinkingTo` (events that reference an entity), `factsCitingItems`, timeline.
- AI layer: `llmService.js` with streaming `llm:chat-start`, provider adapters for gemini, anthropic
  and openai, the opt-in gate (`AI_DISABLED`), `abortAll`/`abortEpoch`, and `estimateTokens` in the renderer.
- `CorkboardView` (binder-folder cards with thumbnails via `useAssetUrl`). It's a visual reference for the wall.

## Part 1: Transcript import (non-AI)

### Formats

The importer recognises the format from the content, not the extension. It's a pure parser in
`src/chat/` (or `electron/lib/`) with fixture-based tests.

1. **AI Chat Exporter Markdown** (the "AI Chat Exporter for Google AI Studio" browser extension,
   github.com/TheRajatJain/ai-chat-exporter). This is the writer's current route. A real sample was
   reviewed (62 messages, ~160 KB):
   - `# <title>`, then a `| Field | Value |` table with `Exported`, `Model`, `Messages`, and
     `Source` (a link to `aistudio.google.com/prompts/<id>`).
   - `---`, `## 💬 Conversation`, then turns: `### 👤 User` or `### 🤖 Gemini` headings, the
     turn body, separated by `---` lines. A model turn's body may begin with a stray `Model` line
     (UI residue), which is dropped.
   - The footer is `*Exported by [AI Chat Exporter ...]*`, which is dropped.
   - Turn bodies are Markdown and contain their own `###`/`####` headings and `---`-free content.
     Split only on the exact turn-heading lines.
2. **AI Studio's own Drive files** (the "Google AI Studio" Drive folder; JSON with no extension:
   `runSettings`, `systemInstruction`, `chunkedPrompt.chunks[]` with `role`, `text`, `isThought`).
   Thinking chunks (`isThought`) are dropped. Chunks that only reference Drive media become a
   placeholder line such as `[image not imported]`. The schema is unofficial, so parsing is defensive.
   **No real sample has been reviewed yet; get one before implementing this format.**
3. **Plain text fallback**: anything else imports as today, as one body with no turn structure.

An unrecognised structure is never an error. It falls back to plain text. A recognised format that's
malformed partway through (for example, a turn heading with no body) keeps whatever parsed cleanly and says so.

### Storage and display

- An imported transcript stays an item of type `'chat'` with its body in `docs/<id>.md`, so search,
  capture and `resolveSource` keep working unchanged. The importer writes the body in **one canonical
  layout** whatever the input format, with turn headings VRS's own parser recognises, so turn
  boundaries can be recomputed from the stored text at any time. Offsets stay offsets into the stored body.
- New optional `TreeItem` fields on chat items: `importedFormat` (`'aistudio-exporter-md' |
  'aistudio-drive' | 'text'`) and `sourceUrl` (the AI Studio link, opened via `app:open-external`). They're
  additive; unknown fields are already preserved. The import step also places each new chat in the source order
  (see "Ordering sources" below).
- The read-only chat view shows turns visually separated and labelled (you / model).

### Picking files

- The file dialog allows **multi-select**. Each file becomes its own chat item in the chosen binder folder.
- The extension allowlist adds files with **no extension**, since AI Studio Drive files have none. The
  main process sniffs content (it must be valid UTF-8 text or JSON) and refuses binary files.
- Same 5 MB per-file cap as today. One failed file doesn't stop the batch, and a summary reports what was
  imported and what was skipped and why.
- Paste import keeps working and runs the same format detection on the pasted text.

## Part 2: Card wall and full card view (non-AI)

### Card wall

- A new view reached from the bible area, with a **tab per entity kind** showing a count
  (Characters 12, Locations 8, ...), plus "Other" for entities of unknown kind.
- Each entity is a small card with its title, a portrait thumbnail if it has one, and **3–5 key kept
  facts** (attribute: value). Badges show the open contradictions count and the proposed facts count, or
  "all reviewed".
- Only `kept` facts appear on the card. Set-aside facts never do.
- Clicking a card opens the full view. There's also a way to create a new entity in the current kind.

### Full card view

The layout was agreed with the writer from a mockup:

- **Header**: the portrait, the title, the kind, the counts ("in N sources · M facts"), the
  open-conflict and to-review badges, and the summary line (the entity's existing `synopsis`, editable in place).
- **Canon**: kept facts, one line per attribute, each showing how many sources support it.
  `when` facts render as story positions, as today.
- **Needs a decision**: open contradictions with one-click keep-one/keep-all (reusing the existing
  decision ops), and proposed facts with their quote, evidence label (Part 3) and Keep / Set aside.
- **Notes**: the entity's existing body.
- **Side column**: linked **images** (a strip), **audio** (play inline), **maps** (images for now),
  **Appears in** (events via `eventsLinkingTo`), **Related** (references to other entities), and
  **Came from** (the distinct source items of its facts, each opening the source).
- Linking media reuses `references`. "+ link" picks an existing binder item, and it's fine to also offer
  importing new media there through the existing `project:import-media`.

This can replace or wrap the current `EntityPanel`. The builder decides, but the existing fact
editing, source links and decision flows must keep working.

### Builder's call (marked)

- **Which facts show on a card**: my call is that the writer can pin facts to the card. Unpinned
  cards show the first kept facts in a sensible per-kind attribute order (for example, character: role,
  age, ...). Store pins on the entity item, for example `cardFacts: string[]` of attribute keys.
- **Portrait**: the first referenced image item, unless the writer picks one (`portraitId`).

### Part 2 implementation decisions

- The wall is a workspace mode ("Cards" in the toolbar, next to Conflicts and Timeline). Clicking a card opens the full
  view in place; "Card wall" goes back, "Open in editor" opens the entity in the research view, and the editor's facts
  panel has "Open card".
- The full view sits alongside `EntityPanel` rather than replacing it. The full view handles canon, pins, decisions,
  pending facts, notes and links; `EntityPanel` keeps set-aside facts, "Mark unreviewed" and editing kept facts.
- A card shows its pinned lines only when any are pinned (stale pins are ignored), else the first five canon lines in
  `DEFAULT_CARD_ORDER`. An attribute the writer kept several versions of shows them joined with " / ".
- "In N sources" counts the distinct source items of live (kept and proposed) facts. Each canon line's count is the
  distinct sources of the facts that agree on that value. Part 3's `evidence` list will feed both counts.
- Proposed facts that are part of an open conflict show only inside that conflict, not again in the pending list.
- New entities from the wall go in the folder holding the first entity of that kind (top level if none).
- Importing new media from the card is not offered yet: "Link an item" links existing binder items.

## Part 3: AI extraction to proposals (AI only)

### What the writer does

1. Chooses sources: one or more chat items, AI Chats (`'ai-chat'`) or documents, from the binder or
   from a chat's toolbar.
2. Sees an estimate (sources, approximate tokens, model) and starts the run. They can cancel at any time.
3. Reviews the results in a **review queue**, grouped by card, and approves new cards and keeps or sets
   aside proposed facts.

### How a source is read

- **Whole conversation in one request** when it fits the model's input limit (`ModelInfo.inputTokenLimit`,
  leaving headroom; it's optional and the OpenAI adapter doesn't set it, so when it's unknown assume a conservative
  limit, my call ~100k tokens). The writer's sample is ~40k tokens. Whether an option was adopted can only be judged
  from **later** turns, which is why reading the whole chat matters.
- Only when it doesn't fit, split into consecutive turn-aligned chunks. Each chunk request carries a running
  summary of what was established so far (entities and adopted facts), so "built on" judgements still work
  across chunk boundaries.
- The request includes the current canon so the model attaches facts to existing cards instead of
  inventing duplicates. That means existing entity names and kinds, the attribute names already in use per kind
  (`attributeSuggestions`), and the live (kept **and** proposed) and rejected values of those attributes.
  The prompt tells the model to **reuse an existing attribute name and an existing value's exact wording** when
  it means the same thing. This is what makes exact matching (below) work across chats, chunks and runs.
  `buildCanonText` is the starting point. If this canon section would exceed a size cap, it's trimmed
  to the entities the source mentions by name (my call).
- The response is **structured JSON**, using each provider's structured-output feature (Gemini response
  schema, OpenAI JSON schema, Anthropic tool use or JSON). The provider wire formats must be checked
  against the current provider docs, per the project rule. Responses are validated, and invalid items are dropped and counted.
- Any configured provider works, defaulting to the app's default provider and model. The writer can
  pick another model for the run.

### What comes back, per proposal

- `entity`: an existing entity id, or a **new card proposal** (`kind`, `title`, short reason).
- `attribute` and `value`. The value is the condensed phrasing itself (one field, which becomes
  `Fact.value` and is what gets fingerprinted); `when` is a story position where it can be.
- `evidence`: one or more quotes from the source, each tagged with the turn it came from.
- `strength`:
  - **said**: stated in the writer's own turn;
  - **built_on**: the model offered it and the writer's later turns used it (evidence includes the later
    passage);
  - **suggested**: the model offered it and the writer never came back to it.
- `replaces` (optional): when the writer changed their mind **within the same source**, only the later
  version is proposed, and the earlier one is noted here, not raised as a conflict.

The writer sometimes states choices outright but more often just builds on them, so the prompt must
instruct the model to look for later use, not only explicit acceptance.

**Sources without turns** (documents, plain-text-fallback chats, chats imported before this phase): the writer may
have pasted raw Gemini output into them, so they're **treated like model output unless the writer says otherwise**
(the writer's decision).

- Before extraction, VRS re-runs format detection on the stored body. An older import that turns out to be exporter
  Markdown gets its turns recognised without re-importing.
- If there are still no turns, every proposal from the source is **suggested** by default and lands in the "Only
  suggested" pile, not in the bible.
- A per-item flag, **"This is my own writing"** (`ownWriting: true`, set in the Inspector or in the extraction
  dialog), tells VRS the whole source is the writer's. Its proposals are then **said** and go to the bible as
  `proposed` facts.

### Turning results into bible state

- Quotes are located in the stored text with the existing `locateQuote`. A quote that can't be found is
  dropped, never stored with made-up offsets. Offsets follow the bible's source rules (body offsets for
  `'chat'` and documents, per-message offsets with `messageId` for `'ai-chat'`).
- **said** and **built_on** proposals become `proposed` facts in `bible/bible.json` (origin `"ai"`) on the
  matching entity. They then flow through the existing pending-facts UI and contradiction detection.
- **suggested** proposals are **not** added to the bible. They sit in a separate, collapsible
  "Only suggested" pile in the review queue. Promoting one makes it a `proposed` fact. This keeps
  never-adopted brainstorms out of the contradiction queue.
- **New card proposals** are not binder items until approved. Approving one creates the entity item (in a
  folder of the writer's choice, defaulting to a per-kind folder) and attaches its facts as `proposed`.
  Rejecting one is sticky (see below), and its facts go with it.
- **Repeated evidence merges.** If a proposal matches an existing live fact of the same entity, attribute
  and normalized value (the existing `groupVersions` notion of "agree"), the evidence is added to that fact
  instead of creating a new one. This covers ten mentions in one chat, the same detail in several chats, and
  the shared prefix of a branched chat. A fact keeps `source` (primary) for compatibility and gains an
  additive `evidence: { source: FactSource, strength }[]` list. Card "N sources" counts come from it.

### Stickiness and caching

Stored in a new project file, `bible/extraction.json` (written in the bible save step, unknown fields
kept). It holds:

- **Rejections**: a fingerprint per rejected proposal (entity, or the proposed card's kind and normalized
  title, plus `attributeKey` and normalized value; exact match, relying on the wording reuse above). A re-run
  never proposes a fingerprint the writer rejected.
  - **Counts as a rejection (my call):** setting aside a *proposed* AI fact (review queue or the fact's own
    Set aside), rejecting a new card, or dismissing a "suggested" item. These are explicit "no"s.
  - **Doesn't count:** facts set aside by a conflict decision (`keepOne`, "Keep the newer"). That's a
    choice between versions, not a rejection. If a later source brings that value back, it arrives as a new
    `proposed` fact and the contradiction reopens, matching the bible's existing rule that a new differing
    fact reopens a decision. So nothing is silently swallowed, and `reopen` needs no fingerprint handling.
  - A small "Rejected" list (per card, in the full view) shows rejections and lets the writer lift one.
- **Run cache**: per source, a hash of the source content, the extraction prompt version and the model,
  mapped to the validated results. Re-running an unchanged source with the same model makes no request.
  Cached results store raw entity **names and kinds** alongside ids and are **re-matched against the current
  canon every time they're applied** (my call), so approving, renaming or deleting cards doesn't invalidate the
  cache or spend tokens again. A cached new-card proposal whose title now matches an existing entity attaches to it.
- **Pending "suggested" pile and pending new-card proposals**, so the queue survives closing the app.

### Ordering sources (newer wins, as a suggestion)

There are no dates. Exported Markdown only carries the export date, so the writer sets a **relative order**
instead (the writer's decision). The writer expects only a handful of competing versions, so a short ordered list
is enough.

- The project keeps **one source order**: an ordered list of the item ids that can be extraction sources
  (imported chats, AI Chats, documents), oldest first. It's stored in `bible/bible.json` as `sourceOrder` (Part 1 implementation decision: that file already
  loads, saves, recovers and is watched). Ids of deleted items
  are pruned, and an item missing from the list counts as oldest.
- **Placing each import as it arrives:** the import step shows the existing ordered sources and asks where the new
  chat goes, defaulting to newest. In a multi-file import, the batch is ordered in the same step, starting in
  file-picker order.
- AI Chats and documents created in VRS are appended as newest when created, which is right in practice. They
  can be moved.
- A **Source order** panel lets the writer reorder at any time by dragging.
- When two sources disagree, the existing contradiction still appears, because there are two live
  versions. The conflict card offers **"Keep the newer"** as the suggested one-click choice, meaning the
  version whose latest evidence sits furthest down the source order. It's never applied automatically, since the
  writer sometimes rewrites a chat from scratch and the older one may be the keeper. When both versions'
  evidence comes from the same source, the in-source rule (`replaces`) already applies.

### Semantic conflict check

- It's user-triggered from a card's full view (that entity) or the card wall (one kind), and bounded to
  that scope with a cap on facts sent. It shows an estimate first.
- The AI is asked for pairs of live facts that conflict in meaning (for example, "age 24" vs "born 40
  years before the story"). Each flag shows both facts and the model's one-line reason. The writer can
  dismiss a flag (sticky, stored in `extraction.json`) or act on it with the normal fact controls.
  Flags are advisory and never change fact status.

### Main process and IPC

- A new `llm:extract` channel (non-streaming result, or stream-then-collect internally) and
  `llm:conflict-check`. Both are refused with `AI_DISABLED` while AI is off, are cancellable, are
  aborted by `abortAll()`, and respect `abortEpoch`.
- The renderer builds the request text, as AI Chat does today. The main process sends it and returns
  validated JSON. Keys never reach the renderer. The `MAX_REQUEST_CHARS` cap applies.
- Update `src/vite-env.d.ts` and the bridge-surface e2e test for new preload functions.
- The e2e fake provider (`e2e/fakeProvider.ts`) gains a structured-extraction response so the whole flow
  can be driven end to end.

## Constraints

- All project rules in CLAUDE.md: opt-in AI, main process owns disk and network, `validateProjectPath`,
  `atomicWriteFile`, DOMPurify for any rendered Markdown, theme tokens, tests first, `npm run gate`.
- Pure logic stays in `src/bible/` and `src/chat/` (or a new `src/extraction/`): parsing, merging,
  fingerprints, ordering and review-state transitions are pure, unit-tested functions.
- Save order gains `bible/extraction.json` right after `bible/bible.json`.
- Schema: the changes are additive (new optional item fields, an optional `evidence` on facts, a new
  file). My call: no `schemaVersion` bump unless the builder finds an existing file's meaning changes.

## Suggested build order

1. Transcript import (exporter Markdown first; Drive JSON once a sample exists), with the turn-labelled chat view.
2. Card wall and full card view.
3. Extraction: request building, structured output per provider, merging, review queue, stickiness, cache.
4. Semantic conflict check.

Each step ships on its own: 1 and 2 are useful without AI.

## Left to the builder

- Exact component structure, where the card wall lives in the workspace navigation, and whether the full
  view replaces `EntityPanel`.
- Prompt wording (versioned, since the version is part of the cache key), chunk sizes and headroom.
- Exact JSON schema for extraction results, as long as it carries the fields above.
- The per-kind default attribute order for unpinned cards.
