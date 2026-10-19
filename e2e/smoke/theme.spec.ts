import fs from 'fs/promises';
import path from 'path';
import type { Page } from 'playwright/test';
import { test, expect, launchApp, quitApp } from '../electron-launch';

const prefersDark = (window: Page) => window.evaluate(() => matchMedia('(prefers-color-scheme: dark)').matches);
// Playwright emulates a light colour scheme by default; drop that so the page sees what nativeTheme reports.
const followNativeTheme = (window: Page) => window.emulateMedia({ colorScheme: null });
const surfaceColor = (window: Page) => window.evaluate(() => getComputedStyle(document.querySelector('.bg-surface')!).backgroundColor);

test('the theme choice applies at once and survives a restart', async ({ userDataDir }) => {
  let { app, window } = await launchApp(userDataDir);
  let light: string;
  try {
    await followNativeTheme(window);
    await window.getByRole('button', { name: 'Settings', exact: true }).click();
    const themes = window.getByRole('dialog', { name: 'Settings' }).getByRole('group', { name: 'Theme' });
    await expect(themes.getByRole('button', { name: 'System' })).toHaveAttribute('aria-pressed', 'true');

    await themes.getByRole('button', { name: 'Light' }).click();
    await expect.poll(() => prefersDark(window)).toBe(false);
    light = await surfaceColor(window);

    await themes.getByRole('button', { name: 'Dark' }).click();
    await expect(themes.getByRole('button', { name: 'Dark' })).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(() => prefersDark(window)).toBe(true);
    expect(await surfaceColor(window)).not.toBe(light);
  } finally {
    await quitApp(app);
  }

  const stored = JSON.parse(await fs.readFile(path.join(userDataDir, 'settings.json'), 'utf-8'));
  expect(stored.theme).toBe('dark');

  ({ app, window } = await launchApp(userDataDir));
  try {
    await followNativeTheme(window);
    // Applied before the window opened, not after the renderer asked.
    expect(await prefersDark(window)).toBe(true);
    await window.getByRole('button', { name: 'Settings', exact: true }).click();
    const themes = window.getByRole('dialog', { name: 'Settings' }).getByRole('group', { name: 'Theme' });
    await expect(themes.getByRole('button', { name: 'Dark' })).toHaveAttribute('aria-pressed', 'true');
  } finally {
    await quitApp(app);
  }
});
