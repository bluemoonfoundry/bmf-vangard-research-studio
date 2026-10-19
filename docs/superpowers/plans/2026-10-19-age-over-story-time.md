# Ages over Story Time Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Age facts can carry "years since the story's start"; dated ages are compared by implied birth (2+ years apart conflict), plain-text ages are never compared.

**Architecture:** A third fact value shape `DatedAge { age, year }` joins `string` and `StoryPosition`, allowed only on the `age` attribute. Pure logic lives in a new `src/bible/ages.ts`; `groupVersions` groups dated ages by implied start age, and `findContradictions` skips plain-text ages. One formatter (`formatValue`) replaces the per-file `valueText` copies. Extraction keeps its text-only schema: the model writes "18 at year 12" and `apply.ts` parses it, the way `when` values are parsed today.

**Tech Stack:** TypeScript, React 19, Vitest (main + renderer projects), Playwright Electron e2e.

**Spec:** `docs/superpowers/specs/2026-10-19-age-over-story-time-design.md` (beads: vrs-063.21)

## Global Constraints

- The attribute is matched by `attributeKey(attribute) === 'age'` (export `AGE = 'age'` from `src/bible/normalize.ts`, next to `WHEN`).
- `age` and `year` are whole numbers ≥ 0.
- Implied start age = `age − year`. Two dated ages conflict when their start ages differ by **2 or more**; a 1-year difference agrees.
- An `age` fact whose value is a string is never compared, with anything.
- Display wording for a dated age everywhere (UI, export, AI text): `"18 at year 12"`.
- Project `schemaVersion` becomes 3 (v2 → v3 is a no-op migration).
- `EXTRACTION_PROMPT_VERSION` becomes 2.
- AI stays strictly opt-in; nothing here adds an AI dependency to a non-AI feature.
- Use theme-token utilities only (`text-content-muted`, etc.).

## Review Focus

1. **Existing projects with plain ages** ("6" and "18" on one character): the project opens (migrating to v3 with a `.v2.bak`), and no contradiction is shown. Pinned in Task 2 and Task 3.
2. **A character born after the story starts** ("3 at year 10"): reads as "born in year 7", not "-7 at the start". Pinned in Task 2.
3. **A chain of near-misses** (start ages 0, 1, 2): grouped deterministically as {0, 1} and {2}, so it is one contradiction, stable across runs and input order. Pinned in Task 2.
4. **A year typed next to a non-numeric age** ("about 40", year 3): the form refuses with a message instead of silently saving plain text. Pinned in Task 4.
5. **The AI writing an age in an unexpected shape** ("eighteen", "18", "18 at year twelve"): stays plain text and is never compared; only the parseable forms become dated. Pinned in Task 5.

---

### Task 1: The `DatedAge` value and one formatter

**Files:**
- Modify: `src/project/types.ts` (add `DatedAge`, `FactValue`; `Fact.value: FactValue`)
- Modify: `src/bible/normalize.ts` (add `AGE`, `isAgeAttribute`, `isPosition`, `isDatedAge`, `formatAge`, `formatValue`)
- Modify, replacing local `valueText`/`isPosition` copies with the shared helpers: `src/bible/contradictions.ts`, `src/bible/ordering.ts`, `src/bible/exportMarkdown.ts`, `src/components/bible/FactRow.tsx` (keep exporting `valueText` as an alias of `formatValue` or update its importers), `src/components/bible/VersionCard.tsx`, `src/extraction/review.ts`, `src/extraction/request.ts`, `src/extraction/conflictCheck.ts` (`factValueText`), `src/chat/buildChatRequest.ts` (keeps its own `positionText`; adds the dated branch via `formatAge`), `src/extraction/types.ts` (`value: FactValue`), `src/components/bible/FactForm.tsx` (types only)
- Test: `src/bible/bible.test.ts` (`describe('normalize')`)

**Interfaces:**
- Produces:
  - `interface DatedAge { age: number; year: number }`, `type FactValue = string | StoryPosition | DatedAge` (in `@/project/types`)
  - `AGE = 'age'`, `isAgeAttribute(attr: string): boolean`
  - `isPosition(v: FactValue): v is StoryPosition` (object with `season`)
  - `isDatedAge(v: FactValue): v is DatedAge` (object with numeric `age` and `year`)
  - `formatAge(a: DatedAge): string` → `"18 at year 12"`
  - `formatValue(v: FactValue): string` → string as is, position via `formatPosition`, dated via `formatAge`

- [ ] **Step 1: Write the failing test** in `describe('normalize')`:

```ts
it('recognises and formats dated ages', () => {
  expect(isAgeAttribute(' Age ')).toBe(true);
  expect(isDatedAge({ age: 18, year: 12 })).toBe(true);
  expect(isDatedAge({ season: 1 })).toBe(false);
  expect(isPosition({ age: 18, year: 12 })).toBe(false);
  expect(formatAge({ age: 18, year: 12 })).toBe('18 at year 12');
  expect(formatValue({ age: 6, year: 0 })).toBe('6 at year 0');
  expect(formatValue({ season: 2, episode: 3 })).toBe('S2 · E3');
  expect(formatValue('green')).toBe('green');
});
```

- [ ] **Step 2: Run it** — `npx vitest run src/bible/bible.test.ts` — expect FAIL (exports missing).
- [ ] **Step 3: Implement** the helpers, widen the types, and switch every listed file to `formatValue`/`isPosition`. Where AI text applies `oneLine` to strings, keep doing that (`typeof v === 'string' ? oneLine(v) : formatValue(v)`). No behavior change for strings or positions.
- [ ] **Step 4: Verify** — `npx vitest run src/bible src/extraction src/chat src/components/bible` passes, and `npm run typecheck` is clean.
- [ ] **Step 5: Commit** — `feat(bible): DatedAge value shape and shared value formatter (vrs-063.21)`

### Task 2: Comparing ages (`src/bible/ages.ts`, contradictions, card lines)

**Files:**
- Create: `src/bible/ages.ts`, `src/bible/ages.test.ts`
- Modify: `src/bible/contradictions.ts` (`groupVersions`, `findContradictions`)
- Modify: `src/bible/cards.ts` (`CanonVersion.label?`), `src/components/bible/EntityCard.tsx` (render `v.label ?? formatValue(v.value)`), `src/components/bible/EntityPanel.tsx` (age-at-start line)
- Test: `src/bible/bible.test.ts` (`describe('contradictions')`), `src/bible/cards.test.ts`, `src/components/bible/EntityPanel.test.tsx`

**Interfaces:**
- Consumes: `DatedAge`, `isDatedAge`, `isAgeAttribute`, `formatValue` (Task 1)
- Produces (in `@/bible/ages`):
  - `AGE_TOLERANCE = 2`
  - `startAge(a: DatedAge): number` → `a.age - a.year`
  - `groupDatedAges<T>(items: T[], ageOf: (t: T) => DatedAge): T[][]`: sort by `startAge` ascending (ties by input order), start a new group when an item's start age is `>= AGE_TOLERANCE` above the group's first. Deterministic for any input order.
  - `startAgeText(ages: DatedAge[]): string` (one group): with `lo`/`hi` the min/max start age: `hi <= 0` → `"born in year N"` / `"born in years N–M"` (N = `-hi`, M = `-lo`); else `"N at the start"` / `"N–M at the start"`. Uses an en dash.
  - `ageAtStart(bible: Bible, entityId: string): string | null`: the `startAgeText` of the entity's **kept** dated ages when they form exactly one group; `null` when there are none or more than one group.

- [ ] **Step 1: Write the failing tests** in `src/bible/ages.test.ts`:

```ts
it('groups by implied start age with a 2-year threshold', () => {
  const g = groupDatedAges([{ age: 18, year: 12 }, { age: 6, year: 0 }, { age: 17, year: 12 }], a => a);
  // start ages 5, 6, 6; ties keep input order
  expect(g).toEqual([[{ age: 17, year: 12 }, { age: 18, year: 12 }, { age: 6, year: 0 }]]);
});
it('splits a near-miss chain deterministically', () => {
  const ages = [{ age: 2, year: 0 }, { age: 0, year: 0 }, { age: 1, year: 0 }];
  const expected = [[{ age: 0, year: 0 }, { age: 1, year: 0 }], [{ age: 2, year: 0 }]];
  expect(groupDatedAges(ages, a => a)).toEqual(expected);
  expect(groupDatedAges([...ages].reverse(), a => a)).toEqual(expected);
});
it('describes the start age', () => {
  expect(startAgeText([{ age: 6, year: 0 }, { age: 18, year: 12 }])).toBe('6 at the start');
  expect(startAgeText([{ age: 5, year: 0 }, { age: 18, year: 12 }])).toBe('5–6 at the start');
  expect(startAgeText([{ age: 3, year: 10 }])).toBe('born in year 7');
  expect(startAgeText([{ age: 0, year: 0 }])).toBe('born in year 0');
});
it('ageAtStart uses kept dated ages only and gives up on a conflict', () => {
  // kept 6@0 + kept 18@12 + proposed 9@0 -> '6 at the start'; kept 6@0 + kept 9@0 -> null;
  // only plain 'age: 6' -> null
});
```

  In `describe('contradictions')`:

```ts
it('never compares plain-text ages', () => {
  // 'age: 6' and 'age: 18' (strings) on one entity -> findContradictions(...) is []
});
it('flags dated ages 2+ years apart and accepts 1', () => {
  // 6@0 + 17@12 -> no contradiction; 6@0 + 20@12 -> one contradiction with 2 versions
});
it('a plain age beside a conflict does not change its fact set', () => {
  // 6@0 + 20@12 acknowledged by keepAll; adding plain 'age: about 20' keeps it acknowledged
});
```

  In `cards.test.ts`: a kept 6@0 + 18@12 character has one `age` canon line with one version labelled `'6 at the start'`. In `EntityPanel.test.tsx`: the panel shows `Age: 6 at the start` for kept 6@0 + 18@12, `Age: born in year 7` for kept 3@10, and no `Age:` line for kept 6@0 + 9@0.

- [ ] **Step 2: Run them** — `npx vitest run src/bible src/components/bible/EntityPanel.test.tsx` — expect FAIL.
- [ ] **Step 3: Implement.** `groupVersions`: dated ages form their own bucket grouped by `groupDatedAges`; each version's `value` is the group's first fact's value. `findContradictions`: skip facts where `isAgeAttribute(f.attribute) && typeof f.value === 'string'` before grouping. `canonLines`: for a version whose value is a dated age, set `label = startAgeText(...)` of its facts. `EntityPanel`: for a character with a non-null `ageAtStart`, show it as a `text-xs text-content-muted` line above the facts list.
- [ ] **Step 4: Verify** — the same command passes; `npm run typecheck` clean.
- [ ] **Step 5: Commit** — `feat(bible): compare dated ages by implied birth (vrs-063.21)`

### Task 3: Storage — validation and schema v3

**Files:**
- Modify: `electron/lib/projectSchema.js` (`isValidDatedAge`, `checkFact`, extraction `pending` check, `CURRENT_SCHEMA_VERSION = 3`, `MIGRATIONS[2]`)
- Modify: `CLAUDE.md` (bible fact shape, `schemaVersion` "now 3")
- Test: `electron/lib/projectSchema.test.ts`

**Interfaces:**
- Produces: on-disk fact `value` for `age` is a string or `{ age, year }` (whole numbers ≥ 0, no other required fields; unknown fields kept).

- [ ] **Step 1: Write the failing tests:**

```ts
it('accepts plain and dated age values', () => {
  // normalizeBible({ facts: [fact({ attribute: 'Age', value: '6' }), fact({ id: 'f2', attribute: 'age', value: { age: 18, year: 12 } })] }) does not throw
});
it.each([{ age: -1, year: 0 }, { age: 1.5, year: 0 }, { age: 6 }, { year: 0 }])('rejects age value %j', (value) => {
  // normalizeBible(...) throws a CORRUPT ProjectFormatError
});
it('refuses a dated age on any other attribute', () => {
  // attribute 'height', value { age: 1, year: 0 } -> CORRUPT
});
it('accepts a dated age in extraction pending', () => { /* pending entry with value { age: 18, year: 12 } */ });
it('migrates a v2 project to v3 unchanged', () => {
  // migrateProject({ manifest: v1Manifest({ schemaVersion: 2 }), tree }) -> schemaVersion 3, tree equal
});
```

- [ ] **Step 2: Run** — `npx vitest run --project main electron/lib/projectSchema.test.ts` — expect FAIL.
- [ ] **Step 3: Implement.** `checkFact`: `when` as today; `age` → string or `isValidDatedAge`, else CORRUPT with message `'needs text or an age at a year ({ age, year }) as its "age" value.'`; any other attribute → string. `MIGRATIONS[2] = (p) => p` with a comment (v2 → v3: age facts may hold `{ age, year }`; older builds must refuse such projects). Update CLAUDE.md's Story Bible facts line and "(now 2)".
- [ ] **Step 4: Verify** — the main project passes: `npx vitest run --project main`.
- [ ] **Step 5: Commit** — `feat(project): store dated ages; schema v3 (vrs-063.21)`

### Task 4: Entering a dated age (FactForm)

**Files:**
- Modify: `src/components/bible/FactForm.tsx`
- Test: `src/components/bible/FactForm.test.tsx` (create if absent; otherwise extend), covering capture, manual add and review edit, since all three use `FactForm`

**Interfaces:**
- Consumes: `isAgeAttribute`, `isDatedAge`, `DatedAge` (Task 1)
- Produces: `FactFormValue.value: FactValue`

- [ ] **Step 1: Write the failing tests** (Testing Library, labels exact):

```ts
it('saves an age with a year as a dated age', () => {
  // attribute 'age'; fields labelled 'Age' ('18') and 'Years since start' ('12') -> onSubmit value { age: 18, year: 12 }
});
it('saves an age without a year as plain text', () => {
  // 'Age' = 'about 40', year blank -> value 'about 40'
});
it('refuses a year next to a non-numeric age', () => {
  // 'Age' = 'about 40', year '3' -> alert 'With a year, the age must be a whole number of 0 or more.'; onSubmit not called
});
it('refuses a year that is not a whole number of 0 or more', () => {
  // year '-1' or '2.5' -> alert 'Years since start must be a whole number of 0 or more.'
});
it('prefills both fields when editing a dated age', () => { /* initial { attribute: 'age', value: { age: 6, year: 0 } } */ });
```

- [ ] **Step 2: Run** — `npx vitest run src/components/bible/FactForm.test.tsx` — expect FAIL.
- [ ] **Step 3: Implement.** When `isAgeAttribute(attribute)`, replace the single value input with an `Age` text input and a `Years since start` number input (`min="0" step="1"`), styled like `PositionFields`. Year blank → plain trimmed text (existing "Enter a value." rule applies). Year filled → both must be whole numbers ≥ 0 (`/^\d+$/`).
- [ ] **Step 4: Verify** — passes, plus `npx vitest run src/components/bible` (CapturePopover, EntityPanel, EntityCard tests still green).
- [ ] **Step 5: Commit** — `feat(bible): enter ages with years since the start (vrs-063.21)`

### Task 5: AI extraction and conflict check

**Files:**
- Modify: `src/bible/ages.ts` (add `parseDatedAge`), `src/extraction/apply.ts` (`valueKey`, `agrees`, proposal value parsing at the `parseWhen` call), `src/extraction/request.ts` (prompt rule, `EXTRACTION_PROMPT_VERSION = 2`), `src/extraction/conflictCheck.ts` (prompt rule)
- Test: `src/bible/ages.test.ts`, `src/extraction/apply.test.ts`, `src/extraction/request.test.ts`, `src/extraction/conflictCheck.test.ts`

**Interfaces:**
- Produces: `parseDatedAge(text: string): DatedAge | null`. After `normalizeText`, accepts `"18 at year 12"`, `"age 18 at year 12"`, `"18 years old at year 12"`, `"18 (year 12)"`; anything else → `null`.

- [ ] **Step 1: Write the failing tests:**

```ts
// ages.test.ts
it.each([['18 at year 12', { age: 18, year: 12 }], ['Age 18 at Year 12', { age: 18, year: 12 }],
  ['18 years old at year 12', { age: 18, year: 12 }], ['18 (year 12)', { age: 18, year: 12 }]])('parses %s', (t, v) => {
  expect(parseDatedAge(t)).toEqual(v);
});
it.each(['18', 'eighteen', '18 at year twelve', 'about 18 at year 12', '-1 at year 2'])('leaves %s as text', (t) => {
  expect(parseDatedAge(t)).toBeNull();
});
// apply.test.ts
it('an age proposal "18 at year 12" becomes a dated proposed fact; "18" stays text', () => { /* ... */ });
it('a dated proposal equal to a live dated fact merges evidence; 17 at year 12 vs 18 at year 12 does not', () => { /* agrees = same age and year */ });
it('fingerprints dated ages by age and year', () => {
  expect(fingerprint('e1', 'age', { age: 18, year: 12 })).toBe(fingerprint('e1', 'Age', { age: 18, year: 12 }));
  expect(fingerprint('e1', 'age', { age: 18, year: 12 })).not.toBe(fingerprint('e1', 'age', { age: 18, year: 11 }));
});
// request.test.ts
it('tells the model how to write ages and sends dated canon ages as "N at year Y"', () => {
  // EXTRACTION_SYSTEM contains the age rule; a canon dated age renders '18 at year 12'; EXTRACTION_PROMPT_VERSION === 2
});
// conflictCheck.test.ts
it('sends dated ages with their year and explains years', () => { /* the request text contains '18 at year 12' and the year rule */ });
```

- [ ] **Step 2: Run** — `npx vitest run src/bible/ages.test.ts src/extraction` — expect FAIL.
- [ ] **Step 3: Implement.** In `apply.ts`, value = `isWhenAttribute` → `parseWhen`; `isAgeAttribute` → `parseDatedAge(p.value) ?? p.value`; else text. `valueKey` for a dated age: `` `#${age}@${year}` ``. `agrees`: two dated ages agree only when age and year are both equal; dated vs text never agree. Extraction prompt rule, next to the `when` rule:
  `'- For an "age" attribute, write "N at year Y" when the source makes clear how many years after the start of the story that age holds (year 0 is the start); otherwise write the age alone.'`
  Conflict-check rule: `'- An age written "N at year Y" means age N, Y years after the story begins.'`
- [ ] **Step 4: Verify** — passes; `npm run typecheck` clean.
- [ ] **Step 5: Commit** — `feat(extraction): extract and check ages at a year (vrs-063.21)`

### Task 6: End-to-end and gate

**Files:**
- Create: `e2e/bible/ages.spec.ts` (follow `e2e/bible/bible.spec.ts` for project creation and stubs)

- [ ] **Step 1: Write the e2e test** `'dated ages conflict only when 2+ years apart'`: create a project and a character; add `age` 6 with years since start 0, then 18 with 12. The Conflicts view shows no contradiction for it, and the character's card shows `6 at the start`. Add 21 at year 12. One contradiction appears listing `6 at year 0` and `21 at year 12`. Save, reopen; `bible/bible.json` holds `{ "age": 21, "year": 12 }` and `vrs.json` has `schemaVersion: 3`.
- [ ] **Step 2: Run** — `npx playwright test e2e/bible/ages.spec.ts` (after `npm run build`) — passes.
- [ ] **Step 3: Gate** — `npm run gate` — typecheck, lint, unit and e2e all pass.
- [ ] **Step 4: Commit** — `test(e2e): ages over story time (vrs-063.21)`
