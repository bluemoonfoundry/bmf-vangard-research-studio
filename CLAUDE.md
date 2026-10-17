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
maps, chat transcripts), plus a story bible: structured entities and facts, route-scoped canon, and conflict
detection.

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
e2e/                    Playwright Electron tests (electron-launch.ts fixture: isolated userData, dialog stubs)
```

## Projects and Storage

A project is a folder (`Name.vrs/`) of plain files: `vrs.json` (manifest + `schemaVersion`), `tree.json`
(binder items), `docs/<id>.md`, plus `chats/ assets/ bible/ maps/` for later phases.

- **Main process owns the disk.** `electron/lib/projectStore.js` reads/writes a root; `projectSession.js` holds
  the one open root. Roots come only from native dialogs or the recent list (`recentProjects.js`) -- the
  renderer can never name a folder.
- **Schema changes** bump `CURRENT_SCHEMA_VERSION` and add a step to `MIGRATIONS` in `projectSchema.js`.
  Opening an older project migrates it and keeps `*.v<N>.bak` copies. Newer formats are refused (`TOO_NEW`).
- **Item ids become file names**: always validate with `isValidItemId()`.
- **Save order** is docs, then `tree.json`, then `vrs.json`, then deletions, so an interrupted save never leaves
  the tree pointing at a missing file.
- **Crash recovery** snapshots (same shape as a save payload) live in `userData/recovery/`, never in the project
  folder, and are cleared on save or an explicit discard.
- **External edits**: `projectWatcher.js` filters VRS's own writes by content hash (not timing). The renderer
  reloads clean files and asks before replacing unsaved ones.
- **IPC results** are `{ ok, value | error: { code, message } }` envelopes; `src/project/api.ts` unwraps them.
- **Binder items** are `tree.json` entries (synopsis, label, status, notes, citations, references by id, `asset`);
  every item's body is `docs/<id>.md`. All bodies are loaded on open (search, word counts and export need them).
- **Media** is copied into `assets/<id>.<ext>` by `project:import-media` (native dialog; name chosen in main,
  allowlist in `electron/lib/media.js`). The renderer reads bytes via `project:read-asset` and shows them through
  `blob:` URLs (`src/workspace/assetCache.ts`), never by path. Unwanted assets ride along in a save's
  `deletedAssets`; the main process keeps any the saved tree still references.
- **Links** go through `app:open-external` (http/https only). Never navigate the app window; Markdown previews
  intercept link clicks.
- **E2E** must stub every native dialog (`stubFolderDialogs`, `stubMessageBox`); an unstubbed dialog hangs
  the run on the developer's screen. Use `crashApp()`, not `process().kill()`, to simulate a crash.

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
