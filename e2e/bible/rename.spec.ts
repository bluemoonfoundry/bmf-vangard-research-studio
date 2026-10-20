import fs from 'fs/promises';
import path from 'path';
import type { Page } from 'playwright/test';
import { test, expect, stubFolderDialogs } from '../electron-launch';

const readJson = async (p: string) => JSON.parse(await fs.readFile(p, 'utf-8'));

async function addPlainFact(window: Page, attribute: string, value: string) {
  const panel = window.getByTestId('entity-panel');
  await panel.getByRole('button', { name: 'Add fact' }).click();
  await panel.getByLabel('Attribute', { exact: true }).fill(attribute);
  await panel.getByRole('textbox', { name: 'Value' }).fill(value);
  await panel.getByRole('button', { name: 'Save fact' }).click();
}

test('merging two attribute names brings their values into one conflict', async ({ electronApp, window, workDir }) => {
  const root = path.join(workDir, 'Rename.vrs');
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

  await addPlainFact(window, 'eyes', 'green');
  await addPlainFact(window, 'eye colour', 'brown');
  const conflicts = window.getByRole('button', { name: /^Conflicts/ });
  await expect(conflicts.getByLabel('0 open')).toBeVisible();

  await panel.getByRole('button', { name: 'Rename eyes' }).click();
  await panel.getByLabel('New name').fill('eye colour');
  await expect(panel.getByText('Merges into the existing "eye colour".')).toBeVisible();
  await panel.getByRole('button', { name: 'Rename', exact: true }).click();
  await expect(conflicts.getByLabel('1 open')).toBeVisible();

  await window.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(window.getByText('Saved', { exact: true })).toBeVisible();
  const bible = await readJson(path.join(root, 'bible', 'bible.json'));
  expect(bible.facts.map((f: { attribute: string }) => f.attribute)).toEqual(['eye colour', 'eye colour']);
});
