# Story Bible (vrs-063.4, Phase 3) — Design

Date: 2026-10-17. Status: draft for review.

## Intent

VRS is a research repository for visual-novel writers. Lore piles up across many sources, mostly LLM chats,
and it drifts: one chat says a character dies in Season 3, another says Season 5, in a different place. The
writer needs to **notice contradictions cleanly and decide what to keep**. They can keep one version, or keep
both on purpose, for example when the story will branch later. The second job is **reference**: going
back to look up a character, plotline, place or piece of lore, along with the images, audio, links, chats
and (later) maps gathered around it.

In the motivating case, the writer settled "when does this character die" by checking it against the
order of other events ("these other deaths had to happen first"). So ordering by season/episode, plus
before/after dependencies between events, is part of how contradictions get decided.

Most facts will eventually come from LLM extraction (Phase 5, vrs-063.6), which lands facts as *proposed*.
Phase 3 builds everything that extraction feeds into, and it works fully without AI. Manual fact
capture is a secondary path for occasional additions and fixes.

## Goals

1. **Entities in the binder.** A new binder item type, `entity`, with a kind: character, location, faction,
   item, lore, event, plotline. Entities are filed in ordinary binder folders next to related research. The body
   is a normal Markdown document (the free-form write-up), edited with the existing editor.
2. **Facts with provenance.** A fact is one claim about one entity: *entity · attribute · value*, a status, and
   (usually) a source pointing back to the passage it came from. Clicking the source opens that passage.
3. **Contradiction detection.** It's deterministic: two or more live facts on the same entity and attribute with
   different values are a contradiction. Nothing is ever resolved automatically.
4. **Conflict queue with side-by-side versions** (the chosen layout, mockup option A). A list of open
   contradictions sits on one side. The selected contradiction shows each version as a card with its value,
   quoted source passage, source item title (click through to it), and ordering checks (✓/✗) against event
   dependencies. Actions: **Keep this one** (the others are set aside) or **Keep both** (acknowledged, with
   an optional note). Decisions can be reopened.
5. **Entity page as reference.** Opening an entity shows its write-up, a facts list (kept facts plus
   their sources, a marker where more than one version was deliberately kept, and unreviewed *proposed*
   facts shown as pending), and its linked research via the existing binder references (images, audio, web
   clips, chats, documents). Events show their participants. Plotlines list their events in timeline order.
6. **Events and the timeline.** Story moments ("Mira dies") are their own `event` entities, linked to
   participants. An event's time is a fact with attribute `when`, whose value is a story position: season,
   optional episode, optional order within the episode. Events can declare *must come after* dependencies on
   other events. A browsable **timeline view** lists events in story order, grouped by season. Clicking an
   event opens it. Events that violate a dependency, or whose `when` is an open contradiction, are flagged.
7. **Transcript import.** Paste text, or pick a `.txt`/`.md` file, to create a read-only `chat` binder item.
8. **Manual capture by selection** (mockup option A, the popover). Select a passage in a chat, or any
   document, and a popover at the selection creates a fact pre-filled with the quote as its source: entity
   (pick an existing one or create one), attribute, value. Facts can also be added on an entity page with no
   source.
9. **Markdown export.** The existing dossier export gains a story-bible section: entities grouped by kind,
   each with its kept facts (and "multiple versions kept" called out), plus the timeline in order.

## Non-goals (this phase)

- **Routes and route-scoped canon.** The original issue text asked for these, but the writer decided against
  them: routes belong to the VN-writing app, not the research repository. "Keep both" covers the
  branch case. There is no route model, and no *canon/alternate* vocabulary.
- AI of any kind: extraction, chat, suggestions. That's Phases 4 and 5. Phase 3 must not depend on AI.
- Integration with the VN-writing app (bmf-vangard-renpy-ide) or the Vangard bridge.
- A separate plot/scene outline view. The existing outliner and corkboard, plus plotline pages, cover it.
  "scene" is not an entity kind for now.
- In-world calendars or dates. Story position (season/episode/order) only for now, stored so another
  time scheme can be added later without migrating the data.
- Parsing structured chat exports (ChatGPT/Claude JSON). Plain text and Markdown only. File a follow-up.
- Maps (Phase 6).

## Anti-goals (failure even if it "works")

- Auto-resolving or silently hiding a contradiction.
- Deleting losing versions. Set-aside facts stay on record with their sources, and any decision can be reopened.
- Noisy false contradictions from trivial differences (case, surrounding whitespace).
- Facts whose source link breaks because the source text was edited out from under them.
- Any non-AI feature that needs AI enabled.

## Data model

### Entity (binder item)

`TreeItem` with `type: 'entity'` and `entityKind: 'character' | 'location' | 'faction' | 'item' | 'lore' |
'event' | 'plotline'`. Body in `docs/<id>.md` as usual. Unknown `entityKind` values are kept and shown generically.

- **Links between entities** (an event's participants, an event's plotline) reuse the existing `references`
  (target ids, titles looked up live).
  - *My call:* links are made **from the event**, to its participants and its plotline.
  - A link's role is inferred from the target's `entityKind` (a plotline target means its plotline, any
    other entity means a participant, a non-entity means research). No role field is added to `Reference`.
  - Character, location and plotline pages show the events that link to them as computed backlinks. A
    plotline lists those events in timeline order.
- **Dependencies** are a separate list (below), because they have a direction and a meaning ("must come
  after").

### Chat (binder item)

`TreeItem` with `type: 'chat'`. Its text is stored as `docs/<id>.md` (so search, word counts and export
work unchanged) and it's **read-only** in the UI, which keeps source anchors stable. Optional `importedFrom`
(original file name).

- **Selection and offsets** (*my call*): chats are displayed as **plain text** (preserved line breaks, no
  Markdown rendering), so a selection maps 1:1 to body offsets.
- In documents, capture works in the **source (textarea) view only**. The rendered preview has no capture
  popover, so no rendered-to-source mapping is needed.
- "Open the passage" opens the item in that same view and selects or highlights `start..end`.

*My call:* the project has an unused `chats/` directory, and a code comment mentions `chats/<id>.json`. I
chose the docs path for simplicity. Structured chat storage can come with structured import.

### Fact

Stored in `bible/bible.json` (one file for the project):

```jsonc
{
  "facts": [{
    "id": "…",                  // valid item-id alphabet
    "entityId": "…",            // a binder item of type entity
    "attribute": "death",       // free text; matched case-insensitively, whitespace-collapsed
    "value": "Season 3 finale, Greymere lighthouse",  // string, except attribute "when" (below)
    "status": "proposed" | "kept" | "set_aside",
    "source": {                 // optional
      "itemId": "…",            // chat or document the passage is in
      "quote": "…",             // exact selected text
      "start": 1234, "end": 1301 // character offsets into the body at capture time
    },
    "origin": "manual",         // Phase 5 will add "ai"; Phase 3 only writes "manual"
    "note": "…",
    "createdAt": "…", "updatedAt": "…"
  }],
  "dependencies": [{ "id": "…", "eventId": "…", "afterEventId": "…" }],   // eventId must come after afterEventId
  "decisions": [{
    "id": "…", "entityId": "…", "attribute": "death",
    "kind": "kept_one" | "kept_all",
    "factIds": ["…","…"],       // every live fact the decision covered
    "setAsideIds": ["…"],       // kept_one: the facts this decision set aside
    "note": "…", "at": "…"
  }]
}
```

- **The `when` attribute** has a structured value, `{ "season": 3, "episode": 4?, "order": 2? }`, and is
  edited with dedicated fields. Its position is compared as season, then episode, then order. A missing part
  sorts first within its parent and compares as "unknown", so it never produces a false ✗.
- **Manual facts** are created as `kept` (*my call:* if you typed it yourself, you meant it). Proposed is
  for AI output and for an explicit "mark as unreviewed".
- **Source resolution:** the passage is found at `start..end` if the text there still equals `quote`.
  Otherwise the first occurrence of `quote` is used. If the quote isn't found at all, the source shows as
  "passage no longer found" with the quote still visible. Chats are read-only, but document passages can
  be edited, which is why this fallback exists.
- **Deleting a source item** (*my call*): the binder's delete confirmation says how many facts cite the item
  (counting its descendants too). The facts survive the delete with their quote, and their source then
  shows as "source deleted". Facts are never removed because their source went away.

### Contradictions (derived, never stored)

Group the *live* facts (status `proposed` or `kept`) by `entityId` plus the normalized attribute. A group is a
contradiction when it holds two or more distinct normalized values: trimmed, whitespace-collapsed,
case-insensitive. Facts with equal values corroborate each other and are shown together as one version
listing several sources.

**`when` equality** (*my call*) treats a less specific position as a refinement, not a contradiction.
`{season:3}` and `{season:3, episode:4}` are compatible and group into one version, displayed as the
most specific value. Two positions contradict only when some part present in both differs. Compatibility
isn't transitive (S3E4 and S3E5 are both compatible with S3), so a group whose most specific values
disagree is still a contradiction.

A contradiction is **open** unless a `kept_all` decision covers exactly its current set of live fact ids.
Adding a new differing fact therefore reopens it. Proposed facts that agree with the single kept value
are not contradictions. They show as pending review on the entity page.

### Decisions

Decisions are stored (in `decisions`) so the queue can list them and Reopen knows exactly what to undo.

- **Keep this one** (`kept_one`): the chosen version's facts become `kept`, the other versions' facts become
  `set_aside`, and the decision records which ids it set aside, plus an optional note.
- **Keep both** (or all) (`kept_all`): every version's facts become `kept`. The entity page marks that
  attribute "multiple versions kept".
- **Reopen** acts on one decision. It restores **only the facts that decision set aside** to `kept` and
  deletes the decision, so the contradiction is open again. Facts set aside individually on the entity
  page (a proposed fact dismissed outside any contradiction) aren't decisions and are unaffected.
  Set-aside facts are visible on the entity page under a collapsed "set aside" section, each with its
  own "restore".
- The queue's filter shows open contradictions (default) and past decisions, each with its note and date.

### Ordering checks

For an event E with a dependency "E after A", check using A's resolved `when`. A's `when` counts as
resolved if A has a single kept value, or several kept values that all satisfy the check. An ambiguous
or missing `when` yields "unknown", not ✗.

- **On a conflict card** for E's `when`, each candidate value is checked against every dependency in both
  directions (E after X, and Y after E).
- **On the timeline**, an event is flagged if its kept `when` violates any dependency, or its `when` is an
  open contradiction.
- **Dependency cycles** are reported as a warning on the events involved. They never block saving.

### Placing an event on the timeline (*my call*)

- **One kept `when`:** the event is placed there.
- **Several kept `when` values deliberately kept** (`kept_all`): the event appears **once per value**, each
  entry labelled "version n of m" and linked to the others.
- **An open contradiction on `when`** (for example two manual facts, both kept by default): the event appears
  in a flagged "Timing contested" bucket at the top, with a link to its conflict card, not on the main line.
- **No `when`:** the event goes under "Unplaced".

The plotline event list and the export timeline use the same placement function.

**Export:** open contradictions are written as an "Unresolved" list, never shown as plain kept facts.
`kept_all` attributes list every kept value, marked "multiple versions kept".

## Storage and format

- `bible/bible.json` is written atomically, versioned with the project's `schemaVersion`. Bump
  `CURRENT_SCHEMA_VERSION` to 2. The 1→2 migration needs no data changes; an absent `bible.json` means
  empty. The bump exists so a v1 build refuses a project that has entities and facts (`TOO_NEW`) instead
  of silently dropping them.
- **Save payload** gains `bible?`, validated in `validateSavePayload`: ids valid, statuses known, the
  `when` value well-formed. Facts that reference a missing entity are tolerated on load (hidden) and
  dropped on the next save.
- **Save order:** docs → tree → bible → manifest → deletions. *My call:* deleting an entity removes its
  facts, dependencies and acknowledgements in the same save. An interrupted save at worst leaves orphan
  facts, which are tolerated as above.
- **Crash recovery** snapshots include `bible`. The external-change watcher treats `bible/bible.json` like
  `tree.json`.
- The renderer reducer (`projectState.ts`) and `useProject` get bible state and actions alongside the tree.
  The contradiction, ordering and timeline logic is pure code in `src/bible/` with unit tests.

## UI summary

| Where | What |
|---|---|
| Binder | Entity items with a kind icon; chat items with a chat icon. Add Item gains Entity (kind picker) and Import chat (paste or file). |
| Entity page (editor pane) | Facts panel above the write-up: grouped by attribute; kept facts with source links; "multiple versions kept" marker; pending (proposed) facts with Keep/Set aside; collapsed set-aside section; Add fact. Events also show `when`, dependencies (add/remove) and participants. Plotlines list their events in order. |
| Chat / document view | Selecting text shows an "Add fact" popover (entity picker with create-new, attribute with suggestions from attributes already used on that entity kind, value). |
| Conflict queue | Toolbar button with an open-count badge. Opens a view: list on the left, side-by-side version cards on the right, Keep this one / Keep both + note / Reopen. Acknowledged and resolved items are reachable via a filter. |
| Timeline | Toolbar button. Events grouped by season, in order; flags for dependency violations and open `when` contradictions; click to open the event. Events without a `when` are listed under "Unplaced". |
| Export | The dossier gains a Story Bible section (see goal 9). |

**Attribute suggestions** matter: contradictions only match on identical normalized attribute names, so the
UI should steer writers toward reusing "death" rather than inventing "date of death". There's no fixed
attribute schema per kind.

## Left to the builder

- Whether facts are editable after creation (expected: yes, editing a value re-runs detection), whether
  `when` is allowed outside events, attribute-suggestion scope, and how bible changes join dirty tracking.
- Exact layout, styling and icons (use theme tokens and existing `ui.ts` primitives).
- How the conflict queue and timeline are hosted (replacing the content pane vs a dedicated pane), as long as
  the binder stays usable alongside.
- Keyboard shortcuts.
- Popover positioning mechanics in the textarea/preview.
- How to split the work into reviewable increments. A sensible order: data model and schema → pure logic →
  entity page → chat import and capture → conflict queue → timeline → export.

## Follow-ups to file

- Structured chat-export import (ChatGPT/Claude JSON) into `chats/`.
- Attribute merge/rename tool (fix "death" vs "date of death" after the fact).
- Phase 5 (vrs-063.6) writes `origin: "ai"` facts with status `proposed` into this same model and queue.
