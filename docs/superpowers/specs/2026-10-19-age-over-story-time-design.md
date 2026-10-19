# Age over story time — design

Date: 2026-10-19. Grew out of vrs-063.14 (attribute rename/merge); see "Issues" at the end.

## Why

The writer's stories are historical and span many years. A character can be 6 at the start and 18 in a later
scene, and narrative choices depend on whether they are a child, a teenager or an adult at a given point. Chats
(and AI extraction) state ages throughout ("she's eighteen now") and sometimes get them wrong.

Today `age` is a plain text attribute, so "6" and "18" on the same character are flagged as a **contradiction**
even though both are true at different times, while a genuinely wrong age is indistinguishable from a correct
one at a later time. Success: true ages at different times never conflict; an age that doesn't fit the others is
flagged so the writer can decide which is right.

## How the writer thinks about time

They know roughly **how many years after the start of the story** a scene happens. Not calendar dates, and not
necessarily tied to an event card. Season / episode / order (existing `when` positions) keep ordering scenes and
are unrelated to this feature.

## The model

- **An age fact can carry a year.** A fact whose attribute is `age` may hold an *age at a year*: an age and the
  number of years since the start of the story when that age held ("6 at year 0", "18 at year 12"). The writer
  types the year wherever the age is entered or reviewed. (Decided by the writer.)
- **No anchor.** Every dated age implies when the character was born relative to the start
  (`year − age`). Dated ages on one character are compared with each other by that implied birth.
  (My call: the writer described "6 at the start" as the reference, but any dated age works the same way,
  and it needs no extra concept.)
- **Tolerance: differences of two years or more conflict.** Implied births one year apart agree (birthdays and
  rough years). (Decided by the writer.)
- **An age without a year stays plain text and is never compared,** neither with dated ages nor with other plain
  ages. Existing projects' `age` facts are all plain text and so stop producing the false contradictions.
  (Decided by the writer.)

## Conflicts

A mismatch is an ordinary contradiction in the existing conflict queue, with the existing actions (keep one,
keep all, set aside, reopen) and decision semantics. Only the grouping of facts into "versions" changes for
dated ages: facts whose implied births agree within tolerance form one version.

Builder's call: tolerance is not transitive (births 0, 1, 2 years before the start), so pick a deterministic
grouping rule (e.g. sort by implied birth, start a new version when a fact is 2+ years from the version's
earliest) and test the edge cases. The acknowledgement and `kept_one` rules must keep working exactly as they do
for other attributes.

## Where ages are entered and shown

- **Fact form** (manual facts, editing, chat capture popover): when the attribute is `age`, show an age field and
  an optional "years since start" field, the way `when` shows position fields today. Year left blank stores a plain
  text age. (Mirrors `isWhenAttribute` / `PositionFields`.)
- **AI extraction:** the model may supply the year when the source makes it clear; otherwise it is a plain age.
  The writer confirms in the review queue, where the year can be added or corrected. The extraction schema has
  every property required and no nulls, so the "no year" encoding is the builder's call; bump
  `EXTRACTION_PROMPT_VERSION`. Applying/matching (fingerprints, agreeing-fact merge) must treat dated ages by value
  (age + year) consistently with the rest of `apply.ts`.
- **AI semantic conflict check** (`llm:conflict-check`, `src/extraction/conflictCheck.ts`): ages stay in, and a
  dated age is sent with its year (e.g. "18 at year 12 since the story's start") so the model can catch
  child-versus-adult mismatches against other attributes. (Decided by the writer.) Plain-text ages are sent as
  today. Same-entity same-attribute pairs are still left to exact contradictions, so age-vs-age stays rule-based.
- **Display everywhere a fact value is shown** (card, entity panel, conflict queue, review queue, export): a dated
  age reads like "18 (year 12)"; wording is the builder's call.
- **Card / entity panel:** for a character with dated ages, show the implied **age at the start** (e.g.
  "Age at start: 6"). My call: when the kept dated ages agree within tolerance but span one year, show the range
  ("Age at start: 5–6"); when they conflict (open contradiction), show nothing derived rather than guess. A way to ask
  "how old at year N?" is a nice-to-have, builder's call.

## Storage

`bible.json` facts gain a new value shape alongside `string` and `StoryPosition`; `normalize` must keep it and
drop malformed ones the same way it treats bad positions. Ages and years are whole numbers ≥ 0 (my call; rough
years don't need fractions). My call: bump the project `schemaVersion` (2 → 3, no-op migration step) so an older
VRS build refuses the project (`TOO_NEW`) instead of misreading the new value as a story position.

## Goals / non-goals / anti-goals

- Goals: dated ages, comparison by implied birth with a 2-year threshold, entry and review of the year, no false
  contradictions for ages.
- Non-goals: calendar dates; giving events a year or showing participants' ages on event cards (later, if wanted);
  ages for non-character kinds getting special treatment beyond the same rules (the rules apply to any entity's
  `age` attribute, which is harmless).
- Anti-goals: silently "fixing" or recalculating stored ages; blocking the writer from saving an inconsistent
  age; turning plain-text ages into dated ones by guessing a year.

## Issues

- vrs-063.21: this work (age over story time).
- vrs-063.14 (rename/merge attribute names, e.g. "eyes" vs "eye colour" so they are compared) stays open for later.
- vrs-063.22: telling apart characters who share a name (reused surnames), raised in the same
  conversation.
