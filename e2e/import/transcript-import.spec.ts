import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { test, expect, launchApp, quitApp, stubFolderDialogs, stubOpenFiles } from '../electron-launch';

const FIXTURE = fileURLToPath(new URL('../fixtures/aistudio-exporter-sample.md', import.meta.url));

test('imports an AI Studio export and an extensionless file, and keeps their source order across a restart', async ({ electronApp, window, userDataDir, workDir }) => {
  const root = path.join(workDir, 'Clouds.vrs');
  const plain = path.join(workDir, 'Harbour notes');
  await fs.writeFile(plain, 'Odile keeps the harbour log.\n');

  await stubFolderDialogs(electronApp, root);
  await window.getByRole('button', { name: 'New project…' }).click();
  await expect(window.getByRole('textbox', { name: 'Project name' })).toBeVisible();

  await stubOpenFiles(electronApp, [FIXTURE, plain]);
  await window.getByRole('button', { name: 'Import chat' }).click();
  const dialog = window.getByRole('dialog', { name: 'Import chat' });
  await dialog.getByRole('button', { name: 'Choose files…' }).click();
  await expect(dialog.getByRole('textbox', { name: 'Title for aistudio-exporter-sample.md' })).toHaveValue('Sky Harbour Test Chat');
  await expect(dialog.getByText('AI Studio export · 3 turns')).toBeVisible();
  await expect(dialog.getByRole('textbox', { name: 'Title for Harbour notes' })).toHaveValue('Harbour notes');
  await dialog.getByRole('button', { name: 'Import' }).click();

  const binder = window.getByRole('tree', { name: 'Binder items' });
  await expect(binder.getByRole('treeitem', { name: 'Harbour notes', exact: true })).toBeVisible();
  await binder.getByRole('treeitem', { name: 'Sky Harbour Test Chat', exact: true }).click();
  await expect(window.getByRole('button', { name: 'Open in AI Studio' })).toBeVisible();
  await expect(window.getByLabel('Chat transcript')).toContainText('=== You ===');

  await window.getByRole('button', { name: 'Source order' }).click();
  let order = window.getByRole('dialog', { name: 'Source order' });
  await expect(order.getByRole('listitem')).toHaveText([/Sky Harbour Test Chat/, /Harbour notes/]);
  await order.getByRole('button', { name: 'Move 2. Harbour notes up' }).click();
  await order.getByRole('button', { name: 'Save' }).click();

  await window.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(window.getByText('Saved', { exact: true })).toBeVisible();

  const bible = JSON.parse(await fs.readFile(path.join(root, 'bible', 'bible.json'), 'utf-8'));
  const tree = JSON.parse(await fs.readFile(path.join(root, 'tree.json'), 'utf-8'));
  const idOf = (title: string) => tree.items.find((i: { title: string }) => i.title === title).id;
  expect(bible.sourceOrder).toEqual([idOf('Harbour notes'), idOf('Sky Harbour Test Chat')]);
  expect(tree.items.find((i: { title: string }) => i.title === 'Sky Harbour Test Chat'))
    .toMatchObject({ type: 'chat', importedFormat: 'aistudio-exporter-md', sourceUrl: 'https://aistudio.google.com/prompts/abc123' });

  await quitApp(electronApp);
  const relaunched = await launchApp(userDataDir);
  try {
    const w = relaunched.window;
    await w.getByRole('button', { name: 'Open Clouds' }).click();
    await w.getByRole('button', { name: 'Source order' }).click();
    order = w.getByRole('dialog', { name: 'Source order' });
    await expect(order.getByRole('listitem')).toHaveText([/Harbour notes/, /Sky Harbour Test Chat/]);
  } finally {
    await quitApp(relaunched.app);
  }
});
