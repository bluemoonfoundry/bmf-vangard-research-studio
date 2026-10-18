# Phase 5.1: Transcript Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Import AI Studio chats (AI Chat Exporter Markdown) as turn-labelled transcripts, several files at once, each placed in a project-wide source order.

**Architecture:** A pure parser in `src/chat/importFormats.ts` detects the exporter format and writes the body in one canonical turn layout, so turns can be found again in the stored text. The main process only reads files: multi-select, plus extensionless files after a text check. Source order is an optional `sourceOrder` list in `bible/bible.json`, which already loads, saves, recovers and watches. `ChatView` styles turn headings without changing the text, so fact-capture offsets stay valid.

**Tech Stack:** Electron (main process, ESM JS), React 19 + TypeScript, Vitest (`main` and `renderer` projects), Testing Library, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-18-ai-extraction-design.md` (Part 1). Beads: vrs-063.6.1. The AI Studio Drive JSON format is **out of scope** here (vrs-063.6.5, waiting on a real sample).

**Deviation from the spec (intentional):** the spec puts source order in `bible/extraction.json`. This plan keeps it in `bible/bible.json` as `sourceOrder` instead: no new file plumbing, and it's the same save step. Part 3 still creates `extraction.json` for rejections, the cache and pending items. Task 6 updates the spec text.

## Global Constraints

- AI stays out of all of this: import, source order and the chat view must work with AI disabled.
- The main process owns the disk. The renderer never names a path, and files come only from the native open dialog.
- 5 MB per-file cap (`MAX_TEXT_IMPORT_BYTES`), unchanged.
- Stored text has LF line endings and no BOM (`normalizeChatText`). Fact-source offsets are offsets into the stored body.
- Bridge changes update `src/vite-env.d.ts`, `src/test/fakeBridge.ts` and the bridge-surface list in `e2e/smoke/app-launch.spec.ts`.
- Theme-token utilities only (`text-accent`, `text-content-muted`, `border-line`, ...). `no-console`.
- Tests first. `npm run gate` passes before the issue closes.
- Commit after each task. Message endings carry `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **A Windows-saved export (CRLF, BOM) or a pasted export** must still be recognised as the exporter format. Pinned in Task 1.
2. **Markdown inside a turn** (`---` rules, `###` headings, a line reading `Model`) must not split or truncate a turn. Pinned in Task 1.
3. **A non-text file in a multi-file pick** (an image with no extension, a zip) is skipped with a reason while the others import. Pinned in Task 2.
4. **Deleting an imported chat**, or opening a project saved before this phase, must not break the source order: missing ids are pruned on save, and a missing list reads as empty. Pinned in Task 3.
5. **Capturing a fact from a turn-labelled chat** must give offsets into the stored text, unaffected by heading styling. Pinned in Task 5.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/chat/importFormats.ts` (new) | Detect and parse transcript formats; canonical turn layout; find turns in a stored body |
| `src/chat/importFormats.test.ts` (new) | Parser tests |
| `src/chat/fixtures/aistudio-exporter-sample.md` (new) | Small hand-made exporter sample (not user content) |
| `electron/lib/textImport.js` | Extensionless text sniffing; multi-file reading |
| `electron/main.js`, `electron/lib/projectSession.js`, `electron/preload.js` | `project:import-texts` channel (replaces `project:import-text`) |
| `src/project/{types,api,useProject}.ts`, `src/vite-env.d.ts`, `src/test/fakeBridge.ts` | `importTexts` bridge |
| `src/bible/sourceOrder.ts` (new) | Pure source-order operations |
| `src/bible/ops.ts` | `pruneOrphans` also prunes `sourceOrder` |
| `electron/lib/projectSchema.js` | Validate `sourceOrder` |
| `src/project/projectState.ts` | New source items join the order as newest |
| `src/components/bible/ImportChatModal.tsx` | Multi-file import, format detection, placement |
| `src/components/bible/ChatView.tsx` | Turn-heading styling |
| `src/components/bible/SourceOrderModal.tsx` (new) | Reorder sources |
| `src/components/workspace/{Workspace,DocumentEditor}.tsx` | Wiring; "Open in AI Studio" link |

---

### Task 1: Transcript format parser

**Files:**
- Create: `src/chat/importFormats.ts`, `src/chat/importFormats.test.ts`, `src/chat/fixtures/aistudio-exporter-sample.md`

**Interfaces:**
- Produces:
  ```ts
  export type ImportedFormat = 'aistudio-exporter-md' | 'text';
  export type TurnRole = 'user' | 'model';
  export interface ParsedTurn { role: TurnRole; label: string; text: string }
  export interface ParsedTranscript {
    format: ImportedFormat;
    title?: string;          // exporter '# ' heading
    sourceUrl?: string;      // exporter Source link, only https://aistudio.google.com/...
    turns: ParsedTurn[];     // [] for 'text'
    body: string;            // what gets stored: canonical layout, or the normalized input for 'text'
    warnings: string[];      // user-facing, e.g. "1 empty turn skipped."
  }
  export const USER_LABEL = 'You';
  export function parseTranscript(raw: string): ParsedTranscript;
  export function formatTurns(turns: ParsedTurn[]): string;
  export interface TurnSpan { role: TurnRole; label: string; headingStart: number; headingEnd: number; start: number; end: number }
  export function turnSpans(body: string): TurnSpan[] | null;
  ```

**Canonical layout** (exact): each turn is a heading line `=== <label> ===`, a blank line, the turn text, and turns are separated by one blank line. The user's label is always `You` (role `user`); any other label is a model turn. Example: `=== You ===\n\nHello\n\n=== Gemini ===\n\nHi there\n`. The body ends with one `\n`. A text line that would itself match `^=== .+ ===$` is written with one leading space, so it can't be read as a heading.

**Exporter rules** (from the reviewed sample):
- The input is first passed through `normalizeChatText` (BOM, CRLF).
- Detection: the input contains a line exactly `## 💬 Conversation` **and** at least one turn heading after it. Otherwise the format is `text`, the body is the normalized input, and there are no turns.
- Title: the first line, if it starts with `# `. Source: the table row whose first cell is `**Source**`; take the markdown link URL only if it starts with `https://aistudio.google.com/`.
- Turn headings: `### 👤 User` (role user, label `You`) and `### 🤖 <Name>` (role model, label `<Name>`). Split **only** on those exact lines after the Conversation line.
- Turn text: from after the heading to the next heading or the footer. Trim it, then drop one trailing `---` line. In a model turn, also drop a first line that is exactly `Model`.
- Footer: a line starting with `*Exported by [AI Chat Exporter` ends the last turn and is dropped.
- A turn whose text is empty after this is skipped and counted in `warnings` (`"1 empty turn skipped."` / `"N empty turns skipped."`).
- Input that parses as JSON with a `chunkedPrompt` key: format `text`, with the warning `"AI Studio Drive files aren't supported yet; imported as plain text."`

- [ ] **Step 1: Write the fixture.** A short made-up exporter file in the exact shape above: the title `# Sky Harbour Test Chat`, the Field/Value table with `Exported`, `Model`, `Messages`, and `Source` = `[View in Google AI Studio](https://aistudio.google.com/prompts/abc123)`, `## 💬 Conversation`, and three turns (User, Gemini, User). The Gemini turn starts with a `Model` line and contains a `### Inner heading`, a `---` line between paragraphs, and a `**Bold:**` line. It ends with the exporter footer.

- [ ] **Step 2: Write the failing tests** in `src/chat/importFormats.test.ts`:

```ts
import { readFileSync } from 'fs';
import { describe, expect, it } from 'vitest';
import { formatTurns, parseTranscript, turnSpans } from '@/chat/importFormats';

const sample = readFileSync(new URL('./fixtures/aistudio-exporter-sample.md', import.meta.url), 'utf8');

describe('parseTranscript: AI Chat Exporter markdown', () => {
  it('reads title, source and turns', () => {
    const p = parseTranscript(sample);
    expect(p.format).toBe('aistudio-exporter-md');
    expect(p.title).toBe('Sky Harbour Test Chat');
    expect(p.sourceUrl).toBe('https://aistudio.google.com/prompts/abc123');
    expect(p.turns.map(t => [t.role, t.label])).toEqual([['user', 'You'], ['model', 'Gemini'], ['user', 'You']]);
    expect(p.warnings).toEqual([]);
  });
  it('keeps markdown inside a turn and drops the stray Model line', () => {
    const g = parseTranscript(sample).turns[1].text;
    expect(g.startsWith('Model')).toBe(false);
    expect(g).toContain('### Inner heading');
    expect(g).toContain('\n---\n');
    expect(g.endsWith('---')).toBe(false);
  });
  it('drops the footer', () => {
    expect(parseTranscript(sample).turns[2].text).not.toContain('Exported by');
  });
  it('recognises CRLF + BOM input', () => {
    expect(parseTranscript('﻿' + sample.replace(/\n/g, '\r\n')).format).toBe('aistudio-exporter-md');
  });
  it('skips empty turns with a warning', () => {
    const p = parseTranscript(sample.replace(/(### 👤 User\n)[\s\S]*?(\n---\n\n### 🤖)/, '$1\n$2'));
    expect(p.warnings).toEqual(['1 empty turn skipped.']);
  });
  it('ignores a Source link that is not AI Studio', () => {
    expect(parseTranscript(sample.replace('https://aistudio.google.com/prompts/abc123', 'https://evil.example/x')).sourceUrl).toBeUndefined();
  });
});

describe('parseTranscript: fallback', () => {
  it('imports anything else as normalized plain text', () => {
    expect(parseTranscript('a\r\nb')).toEqual({ format: 'text', turns: [], body: 'a\nb', warnings: [] });
  });
  it('flags AI Studio Drive JSON as unsupported', () => {
    const p = parseTranscript(JSON.stringify({ chunkedPrompt: { chunks: [] } }));
    expect(p.format).toBe('text');
    expect(p.warnings[0]).toMatch(/Drive files aren't supported yet/);
  });
});

describe('canonical layout', () => {
  it('formats turns exactly', () => {
    expect(formatTurns([{ role: 'user', label: 'You', text: 'Hello' }, { role: 'model', label: 'Gemini', text: 'Hi there' }]))
      .toBe('=== You ===\n\nHello\n\n=== Gemini ===\n\nHi there\n');
  });
  it('escapes text lines that look like headings', () => {
    const body = formatTurns([{ role: 'model', label: 'Gemini', text: 'a\n=== Fake ===\nb' }]);
    expect(turnSpans(body)).toHaveLength(1);
    expect(body).toContain('\n === Fake ===\n');
  });
  it('turnSpans finds every turn with offsets into the body', () => {
    const body = parseTranscript(sample).body;
    const spans = turnSpans(body)!;
    expect(spans.map(s => s.role)).toEqual(['user', 'model', 'user']);
    expect(body.slice(spans[0].headingStart, spans[0].headingEnd)).toBe('=== You ===');
    expect(body.slice(spans[1].start, spans[1].end)).toBe(parseTranscript(sample).turns[1].text);
  });
  it('turnSpans is null for text without headings', () => {
    expect(turnSpans('just text')).toBeNull();
  });
});
```

- [ ] **Step 3: Run the tests and confirm they fail.** Run: `npx vitest run src/chat/importFormats.test.ts`. Expected: FAIL (module not found).

- [ ] **Step 4: Implement `src/chat/importFormats.ts`** to the rules above. Reuse `normalizeChatText` from `@/bible/entities`. `TurnSpan.start`/`end` cover the turn text only, not the heading or the separating blank lines.

- [ ] **Step 5: Run the tests and confirm they pass.** Run: `npx vitest run src/chat/importFormats.test.ts`. Expected: PASS.

- [ ] **Step 6: Commit.** `git add src/chat && git commit -m "feat(import): parse AI Chat Exporter transcripts into a canonical turn layout"`

---

### Task 2: Multi-file import in the main process

**Files:**
- Modify: `electron/lib/textImport.js`, `electron/lib/textImport.test.ts`, `electron/lib/projectSession.js`, `electron/main.js` (the `project:import-text` handler), `electron/preload.js`, `src/vite-env.d.ts`, `src/project/types.ts`, `src/project/api.ts`, `src/project/useProject.ts`, `src/project/useProject.test.ts`, `src/test/fakeBridge.ts`, `e2e/smoke/app-launch.spec.ts`

**Interfaces:**
- Produces (renderer types in `src/project/types.ts`):
  ```ts
  export interface SkippedImport { fileName: string; message: string }
  export interface TextImportBatch { imports: TextImport[]; skipped: SkippedImport[] }
  ```
  - Bridge: `importTexts(): Promise<VrsIpcResult<TextImportBatch | null>>` (null = cancelled). It **replaces** `importText`. Remove `importText` from the preload, `vite-env.d.ts`, `api.ts`, `useProject`, `fakeBridge` (`nextTextImports: TextImportBatch | null`) and the surface list.
  - `useProject` returns `importTexts(): Promise<TextImportBatch | null>`.
  - Main: `readTextImports(filePaths: string[], opts?): Promise<{ imports, skipped }>` in `textImport.js`. IPC channel: `project:import-texts`.

- [ ] **Step 1: Write failing tests** in `electron/lib/textImport.test.ts`, next to the existing ones:

```ts
it('accepts an extensionless text file and titles it with the whole name', async () => {
  const p = path.join(dir, 'Among the Clouds');
  await fs.writeFile(p, '{"a":1}');
  await expect(readTextImport(p)).resolves.toMatchObject({ title: 'Among the Clouds', fileName: 'Among the Clouds' });
});
it('refuses an extensionless binary file', async () => {
  const p = path.join(dir, 'picture');
  await fs.writeFile(p, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01]));
  await expect(readTextImport(p)).rejects.toMatchObject({ code: 'UNSUPPORTED' });
});
it('refuses an extensionless file that is not valid UTF-8', async () => {
  const p = path.join(dir, 'latin1');
  await fs.writeFile(p, Buffer.from([0x63, 0x61, 0x66, 0xe9]));
  await expect(readTextImport(p)).rejects.toMatchObject({ code: 'UNSUPPORTED' });
});
it('readTextImports imports what it can and reports the rest', async () => {
  const good = path.join(dir, 'a.md'); await fs.writeFile(good, 'hi');
  const bad = path.join(dir, 'b.pdf'); await fs.writeFile(bad, 'x');
  const r = await readTextImports([good, bad]);
  expect(r.imports.map(i => i.fileName)).toEqual(['a.md']);
  expect(r.skipped).toEqual([{ fileName: 'b.pdf', message: expect.stringMatching(/not a supported/) }]);
});
```

In `src/project/useProject.test.ts`, rename the `importText` test to `importTexts`. It should return the fake's `nextTextImports` batch, or null on cancel.

- [ ] **Step 2: Run the tests and confirm they fail.** Run: `npx vitest run electron/lib/textImport.test.ts src/project/useProject.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement.**
  - `readTextImport`: a file with **no** extension is allowed when its first 8 KB contains no NUL byte and the whole file decodes with `new TextDecoder('utf-8', { fatal: true })`. Otherwise refuse with `UNSUPPORTED` and the message `"<name> is not a text file."` Size is checked first, as today.
  - `readTextImports`: reads each path in order and puts any `ProjectFormatError` into `skipped` with its message. Other errors propagate.
  - `projectSession.readTextImports(paths)` mirrors `readTextImport` (`requireRoot()` first).
  - `main.js`: the handler is `project:import-texts` with `properties: ['openFile', 'multiSelections']` and filters `[{ name: 'Chat transcripts', extensions: TEXT_IMPORT_EXTENSIONS }, { name: 'All files', extensions: ['*'] }]`. It returns null on cancel.

- [ ] **Step 4: Run the tests and confirm they pass.** Run: `npx vitest run electron/lib/textImport.test.ts src/project/useProject.test.ts && npm run typecheck`. Expected: PASS. To keep typecheck green until Task 4, adapt `ImportChatModal`'s file button minimally: the prop becomes `importTexts` and it uses the first of `imports`.

- [ ] **Step 5: Commit.** `git commit -am "feat(import): multi-file and extensionless transcript import"`

---

### Task 3: Source order in the bible

**Files:**
- Create: `src/bible/sourceOrder.ts`, with tests in `src/bible/bible.test.ts` (the existing bible test file)
- Modify: `src/project/types.ts` (`Bible`), `src/bible/ops.ts` (`pruneOrphans`), `electron/lib/projectSchema.js` (`normalizeBible`), `electron/lib/projectSchema.test.ts`, `src/project/projectState.ts` (`addItems`), its tests

**Interfaces:**
- Produces:
  ```ts
  // types.ts
  export interface Bible { facts: Fact[]; dependencies: Dependency[]; decisions: Decision[]; sourceOrder?: string[] }
  // sourceOrder.ts
  export const SOURCE_TYPES: readonly string[];   // ['chat', 'ai-chat', 'document']
  export function isSourceItem(item: Pick<TreeItem, 'type'>): boolean;
  /** Oldest first: sources missing from the list (binder order), then listed ones in list order. */
  export function orderedSources(b: Bible, items: readonly TreeItem[]): TreeItem[];
  /**
   * Stores the full order: orderedSources(b, items) minus `ids`, with `ids` (in the given order) spliced in at `index`.
   * `ids` need not be in `items`, so callers pass the items from before the new ones were added.
   */
  export function insertSources(b: Bible, items: readonly TreeItem[], ids: string[], index: number): Bible;
  export function appendSources(b: Bible, ids: string[]): Bible;   // returns b when ids is empty or all present
  export function setSourceOrder(b: Bible, ids: string[]): Bible;
  ```

- [ ] **Step 1: Write failing tests.**
  - `orderedSources`: given items doc A, chat B, folder F and chat C, with `sourceOrder: ['C', 'B']`, it returns `[A, C, B]`. With no `sourceOrder`, it returns `[A, B, C]` in binder order.
  - `insertSources(b, items, ['N1', 'N2'], 1)` with `sourceOrder ['A', 'B']` gives `['A', 'N1', 'N2', 'B']`. With index = length, it gives newest.
  - `appendSources` leaves an existing id in place and returns the same object (`toBe`) when nothing changes.
  - `pruneOrphans` drops `sourceOrder` ids that aren't in the tree, keeps the reference when nothing is pruned, and leaves an absent `sourceOrder` absent.
  - The `projectReducer` `itemsAdded` action with a chat and a folder appends only the chat id to `bible.sourceOrder`.
  - `electron/lib/projectSchema.test.ts`: `normalizeBible({ facts: [], dependencies: [], decisions: [], sourceOrder: ['ok-id'] })` keeps it. `sourceOrder: 'x'` or `[42]` throws `CORRUPT`. A bible with no `sourceOrder` stays without one.

- [ ] **Step 2: Run the tests and confirm they fail.** Run: `npx vitest run src/bible electron/lib/projectSchema.test.ts src/project`. Expected: FAIL.

- [ ] **Step 3: Implement.**
  - `sourceOrder.ts` as specified.
  - `pruneOrphans` gains the `sourceOrder` filter and keeps the "return `b` when unchanged" contract.
  - `normalizeBible` validates `sourceOrder`: when present, it must be an array of `isValidItemId` strings, else `CORRUPT` with the message `bible.json "sourceOrder" must be a list of item ids.`
  - In `projectState.ts`, `addItems` sets `bible = appendSources(state.bible, items.filter(isSourceItem).map(i => i.id))`. This covers new documents, AI Chats, imports and duplicates.

- [ ] **Step 4: Run the tests and confirm they pass.** Same command. Expected: PASS.

- [ ] **Step 5: Commit.** `git commit -am "feat(bible): project-wide source order"`

---

### Task 4: Import dialog with format detection and placement

**Files:**
- Modify: `src/components/bible/ImportChatModal.tsx`, `src/components/workspace/Workspace.tsx` (around the `importingChat` block, ~line 519)
- Test: `src/components/bible/ImportChatModal.test.tsx` (new)

**Interfaces:**
- Consumes: `parseTranscript` (Task 1), `TextImportBatch` / `importTexts` (Task 2), `orderedSources` / `insertSources` (Task 3).
- Produces:
  ```ts
  export interface ImportEntry { title: string; body: string; importedFormat: ImportedFormat; sourceUrl?: string; importedFrom?: string }
  export interface ImportChatModalProps {
    importTexts(): Promise<TextImportBatch | null>;
    /** Existing sources, oldest first. */
    sources: { id: string; title: string }[];
    /** `position` is the index in `sources` before which the batch goes; sources.length = newest. */
    onImport(entries: ImportEntry[], position: number): void;
    onClose(): void;
  }
  ```
  - New optional `TreeItem` fields: `importedFormat?: string; sourceUrl?: string`.

**Behaviour:**
- Paste mode, the current form, keeps the labels `Title`, `Chat text` and the `Import` button. The pasted text goes through `parseTranscript`. The title defaults to the parsed title.
- **Choose files…** opens `importTexts()`. Each picked file becomes a row with a `Title` input labelled `Title for <fileName>` (default: the parsed title, else the file title), a detected-format line (`AI Studio export · N turns` or `Plain text`), any warnings, and Move up / Move down buttons for ordering within the batch. Skipped files are listed as `<fileName>: <message>`.
- **Place in source order**: a `<select>` labelled `Place` with the options `Oldest (before everything)`, `After <title>` for each source, and **default** the last one, newest. With no existing sources, the select is hidden.
- In `Workspace.tsx`, `onImport` calls `addItem({ type: 'chat', parentId, title, importedFrom, importedFormat, sourceUrl }, body)` for each entry, then `updateBible(b => insertSources(b, items, ids, position))`, using the render's `items` from before the adds, then expands the parent and navigates to the first new item. `addItem` already appends the ids as newest (Task 3), and `insertSources` moves them to `position`.

- [ ] **Step 1: Write failing tests** (Testing Library):
  - Pasting the fixture text shows `AI Studio export · 3 turns` and pre-fills the title. Import calls `onImport` with one entry whose `body` starts with `=== You ===`, `importedFormat: 'aistudio-exporter-md'`, the fixture `sourceUrl`, and position = `sources.length`.
  - Choosing files (fake `importTexts` resolves with two imports and one skipped) lists both rows and the skipped line. "Move up" on the second row swaps their order in the `onImport` entries.
  - Picking `Oldest (before everything)` passes position 0.
  - Plain text paste gives `importedFormat: 'text'` and the body unchanged (normalized).

- [ ] **Step 2: Run the tests and confirm they fail.** Run: `npx vitest run src/components/bible/ImportChatModal.test.tsx`. Expected: FAIL.

- [ ] **Step 3: Implement** the modal and the Workspace wiring.

- [ ] **Step 4: Run and confirm.** `npx vitest run src/components && npm run typecheck`. Expected: PASS.

- [ ] **Step 5: Commit.** `git commit -am "feat(import): multi-file import dialog with format detection and source placement"`

---

### Task 5: Turn-labelled chat view and AI Studio link

**Files:**
- Modify: `src/components/bible/ChatView.tsx`, `src/components/workspace/DocumentEditor.tsx` (chat branch, ~line 215)
- Test: `src/components/bible/ChatView.test.tsx` (new), `src/components/workspace/DocumentEditor.test.tsx`

**Interfaces:**
- Consumes: `turnSpans` (Task 1).

**Behaviour:**
- When `turnSpans(text)` is non-null, each heading range renders as `<span data-turn-heading="user|model">` styled as a label: `font-semibold`, `text-accent` for the user, `text-content-muted` for the model. Everything else renders as today. **The `<pre>`'s text content must equal `text` exactly**, so the existing selection-offset logic keeps working. The highlight `<mark>` may overlap a heading boundary; build segments from the union of heading boundaries and highlight boundaries.
- `DocumentEditor`: for a chat item with `sourceUrl`, show a link button `Open in AI Studio` that calls the existing `onOpenLink(item.sourceUrl)`.

- [ ] **Step 1: Write failing tests.**
  - The ChatView rendered with a canonical body has `pre.textContent === body`, and two `[data-turn-heading]` elements with `user` then `model`.
  - With `highlight` spanning from inside a heading into the turn text, `textContent` is still equal and exactly one `mark` contains the highlighted slice.
  - Selecting a range inside the second turn (use the existing selection approach from `DocumentEditor.test.tsx` / `CapturePopover.test.tsx`) reports `start`/`end` such that `body.slice(start, end) === quote`.
  - The DocumentEditor shows `Open in AI Studio` for a chat with `sourceUrl`, and clicking it calls `onOpenLink` with that URL. It's absent without `sourceUrl`.

- [ ] **Step 2: Run the tests and confirm they fail.** Run: `npx vitest run src/components/bible/ChatView.test.tsx src/components/workspace/DocumentEditor.test.tsx`. Expected: FAIL.

- [ ] **Step 3: Implement.**

- [ ] **Step 4: Run and confirm.** Same command. Expected: PASS.

- [ ] **Step 5: Commit.** `git commit -am "feat(chat): label turns in imported transcripts; link back to AI Studio"`

---

### Task 6: Source order panel, end-to-end test, docs

**Files:**
- Create: `src/components/bible/SourceOrderModal.tsx`, `src/components/bible/SourceOrderModal.test.tsx`, `e2e/fixtures/` (if absent) with a copy of the Task 1 fixture, `e2e/import/transcript-import.spec.ts`
- Modify: `src/components/workspace/Workspace.tsx` (toolbar next to `Import chat`, ~line 412), `e2e/electron-launch.ts`, `CLAUDE.md`, `docs/superpowers/specs/2026-10-18-ai-extraction-design.md`

**Interfaces:**
- Consumes: `orderedSources`, `setSourceOrder` (Task 3).
- Produces: `SourceOrderModal({ sources: { id: string; title: string }[]; onSave(ids: string[]): void; onClose(): void })`; `stubOpenFiles(app, files: string[])` in `e2e/electron-launch.ts`.

**Behaviour:**
- A toolbar button `Source order` opens a modal titled `Source order` that lists sources oldest first, with the hint "Oldest at the top. When two sources disagree, VRS suggests keeping the newer one." Each row has Move up / Move down buttons labelled `Move <title> up` / `Move <title> down`. Save calls `updateBible(b => setSourceOrder(b, ids))`.

- [ ] **Step 1: Write failing tests.**
  - `SourceOrderModal`: moving the second row up and saving calls `onSave` with the swapped ids. Cancel doesn't call it.
  - E2E (`e2e/import/transcript-import.spec.ts`, pattern from `e2e/bible/bible.spec.ts`: create a project with `stubFolderDialogs`, then `stubOpenFiles`):
    1. Import the exporter fixture and an extensionless plain-text file in one pick. Both appear in the binder. Opening the exporter one shows `Open in AI Studio`, and the transcript box contains `=== You ===`.
    2. Open `Source order`: the extensionless file is listed after the exporter one (file-picker order, newest default). Move it up and save.
    3. Save the project, quit and relaunch. `Source order` still shows the moved order. Read `bible/bible.json` from disk and assert `sourceOrder` has both ids in that order.

- [ ] **Step 2: Run the tests and confirm they fail.** Run: `npx vitest run src/components/bible/SourceOrderModal.test.tsx && npm run test:e2e -- e2e/import`. Expected: FAIL.

- [ ] **Step 3: Implement** the modal, the toolbar button and `stubOpenFiles`.

- [ ] **Step 4: Update the docs.**
  - `CLAUDE.md` "Projects and Storage": imported chats may be in the canonical turn layout (`=== You ===` / `=== <Model> ===`, parsed by `src/chat/importFormats.ts`) with `importedFormat`/`sourceUrl`.
  - `CLAUDE.md` "Story Bible": `bible.json` may carry `sourceOrder` (oldest-first ids of chat, ai-chat and document items; pruned on save).
  - Spec: in "Ordering sources", say the list lives in `bible/bible.json` as `sourceOrder`, not in `extraction.json`.

- [ ] **Step 5: Run the full gate.** Run: `npm run gate`. Expected: typecheck, lint, unit and e2e all pass.

- [ ] **Step 6: Commit.** `git commit -am "feat(import): source order panel; e2e for transcript import; docs"`
