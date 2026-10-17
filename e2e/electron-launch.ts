import { existsSync } from 'fs';
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
function launchEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && key !== 'ELECTRON_RUN_AS_NODE') env[key] = value;
  }
  return env;
}

/** main.js loads dist/index.html; without a build every spec would time out on a blank window. */
function assertRendererBuilt() {
  const indexHtml = path.join(ROOT, 'dist', 'index.html');
  if (!existsSync(indexHtml)) {
    throw new Error(`Renderer build not found at ${indexHtml}. Run \`npm run build\` first.`);
  }
}

type ElectronFixtures = {
  electronApp: ElectronApplication;
  window: Page;
};

/* eslint-disable no-empty-pattern */
export const test = base.extend<ElectronFixtures>({
  electronApp: async ({}, use) => {
    assertRendererBuilt();
    const app = await electron.launch({ args: [APP_ENTRY], env: launchEnv() });
    await use(app);
    await app.evaluate(({ app: electronApp }) => electronApp.exit(0)).catch(() => {});
  },
  window: async ({ electronApp }, use) => {
    const page = await electronApp.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    await use(page);
  },
});

export { expect } from 'playwright/test';
