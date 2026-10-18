import fs from 'fs/promises';
import path from 'path';
import { test, expect, stubFolderDialogs } from '../electron-launch';

test('shows entities on the card wall and saves a pinned fact', async ({ electronApp, window, workDir }) => {
  const root = path.join(workDir, 'Story.vrs');
  await stubFolderDialogs(electronApp, root);
  await window.getByRole('button', { name: 'New project…' }).click();
  await expect(window.getByRole('textbox', { name: 'Project name' })).toBeVisible();

  await window.getByRole('button', { name: 'Cards', exact: true }).click();
  await window.getByRole('button', { name: 'New character' }).click();
  await window.getByRole('textbox', { name: 'Title' }).fill('Mara');

  const canon = window.getByRole('region', { name: 'Canon' });
  for (const [attribute, value] of [['Role', 'heir'], ['Eyes', 'green']]) {
    await canon.getByRole('button', { name: 'Add fact' }).click();
    await canon.getByLabel('Attribute', { exact: true }).fill(attribute);
    await canon.getByRole('textbox', { name: 'Value' }).fill(value);
    await canon.getByRole('button', { name: 'Save fact' }).click();
  }
  await canon.getByRole('button', { name: 'Pin Eyes to the card' }).click();

  await window.getByRole('button', { name: 'Card wall' }).click();
  const card = window.getByRole('list', { name: 'Cards' }).getByRole('button', { name: /^Mara/ });
  await expect(card).toContainText('green');
  await expect(card).not.toContainText('heir');

  await window.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(window.getByText('Saved', { exact: true })).toBeVisible();
  const tree = JSON.parse(await fs.readFile(path.join(root, 'tree.json'), 'utf-8'));
  expect(tree.items.find((i: { title: string }) => i.title === 'Mara')).toMatchObject({ entityKind: 'character', cardFacts: ['eyes'] });
});
