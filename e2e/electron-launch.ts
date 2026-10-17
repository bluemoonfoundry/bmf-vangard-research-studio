import { existsSync, mkdtempSync, rmSync } from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { test as base, _electron as electron } from 'playwright/test';
import type { ElectronApplication, Page } from 'playwright/test';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

/** Electron main-process entry point. */
export const APP_ENTRY = path.join(ROOT, 'electron', 'main.js');

/** ELECTRON_RUN_AS_NODE=1 is inherited by shells spawned from Electron-based
 *  hosts (VS Code, agent terminals); it makes electron.exe run as plain Node,
 *  which rejects Playwright's Chromium flags and fails every launch. */
function launchEnv(userDataDir: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && key !== 'ELECTRON_RUN_AS_NODE') env[key] = value;
  }
  // Keeps recents and recovery snapshots out of the developer's real profile.
  env.VRS_USER_DATA_DIR = userDataDir;
  return env;
}

/** main.js loads dist/index.html; without a build every spec would time out on a blank window. */
function assertRendererBuilt() {
  const indexHtml = path.join(ROOT, 'dist', 'index.html');
  if (!existsSync(indexHtml)) {
    throw new Error(`Renderer build not found at ${indexHtml}. Run \`npm run build\` first.`);
  }
}

/** Launches the app against `userDataDir`. Relaunching with the same dir simulates restarting VRS. */
export async function launchApp(userDataDir: string) {
  assertRendererBuilt();
  const app = await electron.launch({ args: [APP_ENTRY], env: launchEnv(userDataDir) });
  const window = await app.firstWindow();
  await window.waitForLoadState('domcontentloaded');
  return { app, window };
}

/** Quits and waits for the main process to exit, so its files in userData are released. */
export async function quitApp(app: ElectronApplication) {
  await stopApp(app, () => app.evaluate(({ app: electronApp }) => electronApp.exit(0)));
}

/**
 * Hard-crashes the main process, as a power cut or OS kill would: no close
 * handlers, no unsaved-changes prompt. (ChildProcess.kill() on Windows can
 * let Electron shut down gracefully, which would show the real dialog.)
 */
export async function crashApp(app: ElectronApplication) {
  await stopApp(app, () => app.evaluate(() => process.crash()));
}

async function stopApp(app: ElectronApplication, stop: () => Promise<unknown>) {
  let proc;
  try {
    proc = app.process();
  } catch {
    return; // Playwright already disposed it: the app has exited
  }
  if (proc.exitCode !== null || proc.signalCode !== null) return;
  const exited = new Promise(resolve => proc.once('exit', resolve));
  await stop().catch(() => {});
  await exited;
}

/** Chromium helper processes can hold files briefly after the main process exits (EPERM on Windows). */
function removeDir(dir: string) {
  rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}

/** Makes the next native save/open dialog return `folder`, as if the user picked it. */
export async function stubFolderDialogs(app: ElectronApplication, folder: string) {
  await app.evaluate(({ dialog }, picked) => {
    dialog.showSaveDialog = (async () => ({ canceled: false, filePath: picked })) as typeof dialog.showSaveDialog;
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [picked] })) as typeof dialog.showOpenDialog;
  }, folder);
}

/** Answers the unsaved-changes message box: 0 = Save, 1 = Don't Save, 2 = Cancel. */
export async function stubMessageBox(app: ElectronApplication, response: number) {
  await app.evaluate(({ dialog }, answer) => {
    dialog.showMessageBox = (async () => ({ response: answer, checkboxChecked: false })) as typeof dialog.showMessageBox;
  }, response);
}

type ElectronFixtures = {
  /** Fresh, isolated Electron userData directory for this test. */
  userDataDir: string;
  /** Scratch directory for project folders created by this test. */
  workDir: string;
  electronApp: ElectronApplication;
  window: Page;
};

function tempDir(prefix: string) {
  return mkdtempSync(path.join(os.tmpdir(), prefix));
}

/* eslint-disable no-empty-pattern */
export const test = base.extend<ElectronFixtures>({
  userDataDir: async ({}, use) => {
    const dir = tempDir('vrs-e2e-userdata-');
    await use(dir);
    removeDir(dir);
  },
  workDir: async ({}, use) => {
    const dir = tempDir('vrs-e2e-work-');
    await use(dir);
    removeDir(dir);
  },
  electronApp: async ({ userDataDir }, use) => {
    assertRendererBuilt();
    const app = await electron.launch({ args: [APP_ENTRY], env: launchEnv(userDataDir) });
    await use(app);
    await quitApp(app);
  },
  window: async ({ electronApp }, use) => {
    const page = await electronApp.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    await use(page);
  },
});

export { expect } from 'playwright/test';
