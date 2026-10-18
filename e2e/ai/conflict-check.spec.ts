import fs from 'fs/promises';
import path from 'path';
import type { ElectronApplication, Page } from 'playwright/test';
import { aiTest as test, expect, stubFolderDialogs, stubMessageBox } from '../electron-launch';
import { conflictReply } from '../fakeProvider';

const KEY = 'AIza-e2e-fake-key-conflicts-7d2a';
const REASON = 'Born 40 years before the story makes Mara about 40, not 24.';

async function createProject(electronApp: ElectronApplication, window: Page, root: string) {
  await stubFolderDialogs(electronApp, root);
  await stubMessageBox(electronApp, 1);
  await window.getByRole('button', { name: 'New project…' }).click();
  await expect(window.getByRole('textbox', { name: 'Project name' })).toBeVisible();
}

async function enableAi(window: Page) {
  await window.getByRole('button', { name: 'Settings', exact: true }).click();
  const dialog = window.getByRole('dialog', { name: 'Settings' });
  const gemini = dialog.getByRole('listitem').filter({ has: window.getByRole('heading', { name: 'Google Gemini' }) });
  await gemini.getByLabel('Google Gemini API key').fill(KEY);
  await gemini.getByRole('button', { name: 'Save & test' }).click();
  await expect(gemini).toContainText('Key saved · tested');
  await dialog.getByRole('checkbox', { name: 'Enable AI features' }).click();
  await dialog.getByLabel('Default provider').selectOption({ label: 'Google Gemini' });
  await dialog.getByLabel('Default model').selectOption({ label: 'Gemini 2.5 Flash' });
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(dialog).toBeHidden();
}

async function addMara(window: Page) {
  await window.getByRole('button', { name: 'Cards', exact: true }).click();
  await window.getByRole('button', { name: 'New character' }).click();
  await window.getByRole('textbox', { name: 'Title' }).fill('Mara');
  const canon = window.getByRole('region', { name: 'Canon' });
  for (const [attribute, value] of [['Age', '24'], ['Born', '40 years before the story']]) {
    await canon.getByRole('button', { name: 'Add fact' }).click();
    await canon.getByLabel('Attribute', { exact: true }).fill(attribute);
    await canon.getByRole('textbox', { name: 'Value' }).fill(value);
    await canon.getByRole('button', { name: 'Save fact' }).click();
  }
}

test('no conflict check while AI is off', async ({ electronApp, window, workDir }) => {
  await createProject(electronApp, window, path.join(workDir, 'Off.vrs'));
  await addMara(window);
  await expect(window.getByRole('button', { name: 'Check for conflicts' })).toHaveCount(0);
  await window.getByRole('button', { name: 'Card wall' }).click();
  await expect(window.getByRole('button', { name: 'Check for conflicts' })).toHaveCount(0);
});

test('checks the character wall, shows the flag on the card, and a dismissal sticks', async ({ electronApp, window, workDir, fakeProvider }) => {
  const root = path.join(workDir, 'Ages.vrs');
  await createProject(electronApp, window, root);
  await enableAi(window);
  await addMara(window);
  await window.getByRole('button', { name: 'Card wall' }).click();
  fakeProvider.setReply(conflictReply([{ a: 'F1', b: 'F2', reason: REASON }]));

  await window.getByRole('button', { name: 'Check for conflicts' }).click();
  const dialog = window.getByRole('dialog', { name: 'Check for conflicts: Characters' });
  await expect(dialog.getByText(/^2 facts · ~[\d,]+ tokens · Gemini 2\.5 Flash$/)).toBeVisible();
  await dialog.getByRole('button', { name: 'Start' }).click();
  await expect(dialog.getByText('1 new possible conflict.')).toBeVisible();
  await expect(dialog.getByText(REASON)).toBeVisible();

  // The request asked Gemini for JSON with the facts named by ref; the key never left the main process.
  expect(fakeProvider.streams).toHaveLength(1);
  const body = fakeProvider.streams[0].body as { contents: { parts: { text: string }[] }[]; generationConfig: { responseJsonSchema: { required: string[] } } };
  expect(body.generationConfig.responseJsonSchema.required).toEqual(['conflicts']);
  expect(body.contents[0].parts[0].text).toContain('F1 [kept] Age: 24');
  expect(await window.evaluate(() => document.documentElement.outerHTML)).not.toContain(KEY);

  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  const card = window.getByRole('list', { name: 'Cards' }).getByRole('button', { name: /^Mara/ });
  await expect(card).toContainText('1 flagged');
  await card.click();
  const needs = window.getByRole('region', { name: 'Needs a decision' });
  await expect(needs.getByText(REASON)).toBeVisible();
  await needs.getByRole('button', { name: 'Dismiss' }).click();
  await expect(needs.getByText(REASON)).toHaveCount(0);

  // Checking again: the model flags the same pair, but a dismissed pair never comes back.
  await needs.getByRole('button', { name: 'Check for conflicts' }).click();
  const again = window.getByRole('dialog', { name: 'Check for conflicts: Mara' });
  await again.getByRole('button', { name: 'Start' }).click();
  await expect(again.getByText('No new conflicts found.')).toBeVisible();
  await again.getByRole('button', { name: 'Close', exact: true }).click();

  await window.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(window.getByText('Saved', { exact: true })).toBeVisible();
  const extraction = JSON.parse(await fs.readFile(path.join(root, 'bible', 'extraction.json'), 'utf-8'));
  expect(extraction.flags).toEqual([]);
  expect(extraction.dismissedFlags).toMatchObject([{ label: 'Age: 24 / Born: 40 years before the story' }]);
  // Flags are advisory: both facts are still kept.
  const bible = JSON.parse(await fs.readFile(path.join(root, 'bible', 'bible.json'), 'utf-8'));
  expect(bible.facts.map((f: { status: string }) => f.status)).toEqual(['kept', 'kept']);
});
