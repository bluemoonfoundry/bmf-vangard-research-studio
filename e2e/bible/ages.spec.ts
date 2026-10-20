import fs from 'fs/promises';
import path from 'path';
import type { Page } from 'playwright/test';
import { test, expect, stubFolderDialogs } from '../electron-launch';

const readJson = async (p: string) => JSON.parse(await fs.readFile(p, 'utf-8'));

async function addAge(window: Page, age: number, year: number) {
  const panel = window.getByTestId('entity-panel');
  await panel.getByRole('button', { name: 'Add fact' }).click();
  await panel.getByLabel('Attribute', { exact: true }).fill('age');
  await panel.getByRole('textbox', { name: 'Age' }).fill(String(age));
  await panel.getByRole('spinbutton', { name: 'Years since start' }).fill(String(year));
  await panel.getByRole('button', { name: 'Save fact' }).click();
}

test('dated ages conflict only when 2+ years apart', async ({ electronApp, window, workDir }) => {
  const root = path.join(workDir, 'Ages.vrs');
  await stubFolderDialogs(electronApp, root);
  await window.getByRole('button', { name: 'New project…' }).click();
  await expect(window.getByRole('textbox', { name: 'Project name' })).toBeVisible();

  await window.getByRole('button', { name: 'New item' }).click();
  const dialog = window.getByRole('dialog', { name: 'Add to binder' });
  await dialog.getByRole('radio', { name: 'Entity' }).click();
  await dialog.getByRole('textbox', { name: 'Title' }).fill('Mara');
  await dialog.getByLabel('Kind').selectOption({ label: 'Character' });
  await dialog.getByRole('button', { name: 'Create' }).click();
  const panel = window.getByTestId('entity-panel');
  await expect(panel).toBeVisible();

  await addAge(window, 6, 0);
  await addAge(window, 18, 12);
  await expect(panel.getByText('Age: 6 at the start')).toBeVisible();
  const conflicts = window.getByRole('button', { name: /^Conflicts/ });
  await expect(conflicts.getByLabel('0 open')).toBeVisible();

  await addAge(window, 21, 12);
  await expect(conflicts.getByLabel('1 open')).toBeVisible();
  await expect(panel.getByText(/^Age: /)).toHaveCount(0);
  await conflicts.click();
  const queue = window.getByRole('complementary', { name: 'Contradictions' });
  await expect(queue).toContainText('Mara · age');
  await expect(window.getByRole('article').filter({ hasText: '6 at year 0' })).toBeVisible();
  await expect(window.getByRole('article').filter({ hasText: '21 at year 12' })).toBeVisible();

  await window.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(window.getByText('Saved', { exact: true })).toBeVisible();
  const bible = await readJson(path.join(root, 'bible', 'bible.json'));
  expect(bible.facts.map((f: { value: unknown }) => f.value)).toEqual([{ age: 6, year: 0 }, { age: 18, year: 12 }, { age: 21, year: 12 }]);
  expect((await readJson(path.join(root, 'vrs.json'))).schemaVersion).toBe(3);
});
