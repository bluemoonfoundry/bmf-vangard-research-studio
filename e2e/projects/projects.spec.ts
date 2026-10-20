import fs from 'fs/promises';
import path from 'path';
import type { Page } from 'playwright/test';
import { test, expect, crashApp, launchApp, quitApp, stubFolderDialogs, stubMessageBox } from '../electron-launch';

const readJson = async (p: string) => JSON.parse(await fs.readFile(p, 'utf-8'));

async function addDocument(window: Page, title: string, text: string) {
  await window.getByRole('button', { name: 'New document' }).click();
  await window.getByRole('textbox', { name: 'Document title' }).fill(title);
  await window.getByRole('textbox', { name: 'Document text' }).fill(text);
}

async function docIdFor(root: string, title: string): Promise<string> {
  const tree = await readJson(path.join(root, 'tree.json'));
  return tree.items.find((i: { title: string }) => i.title === title).id;
}

test('creates a project, saves a document, and reopens it after a restart', async ({ electronApp, window, userDataDir, workDir }) => {
  const root = path.join(workDir, 'Dragon Saga.vrs');
  await stubFolderDialogs(electronApp, root);
  await window.getByRole('button', { name: 'New project…' }).click();
  await expect(window.getByRole('textbox', { name: 'Project name' })).toHaveValue('Dragon Saga');

  await addDocument(window, 'Hoard', 'Dragons hoard words, not gold.');
  await expect(window.getByText('Unsaved changes')).toBeVisible();
  await expect(window).toHaveTitle('● Dragon Saga — Vangard Research Studio');
  await window.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(window.getByText('Saved', { exact: true })).toBeVisible();

  // The folder is plain, readable files.
  expect(await readJson(path.join(root, 'vrs.json'))).toMatchObject({ schemaVersion: 3, name: 'Dragon Saga' });
  const id = await docIdFor(root, 'Hoard');
  expect(await fs.readFile(path.join(root, 'docs', `${id}.md`), 'utf-8')).toBe('Dragons hoard words, not gold.');

  await quitApp(electronApp);
  const relaunched = await launchApp(userDataDir);
  try {
    await relaunched.window.getByRole('button', { name: 'Open Dragon Saga' }).click();
    await relaunched.window.getByRole('treeitem', { name: 'Hoard' }).click();
    await expect(relaunched.window.getByRole('textbox', { name: 'Document text' })).toHaveValue('Dragons hoard words, not gold.');
  } finally {
    await quitApp(relaunched.app);
  }
});

test('picks up a document edited outside VRS', async ({ electronApp, window, workDir }) => {
  const root = path.join(workDir, 'External.vrs');
  await stubFolderDialogs(electronApp, root);
  await window.getByRole('button', { name: 'New project…' }).click();
  await addDocument(window, 'Notes', 'written in VRS');
  await window.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(window.getByText('Saved', { exact: true })).toBeVisible();

  const id = await docIdFor(root, 'Notes');
  await fs.writeFile(path.join(root, 'docs', `${id}.md`), 'edited in another editor');
  await expect(window.getByRole('textbox', { name: 'Document text' })).toHaveValue('edited in another editor');
  await expect(window.getByText('Saved', { exact: true })).toBeVisible();
});

test('offers to restore unsaved work after a crash', async ({ electronApp, window, userDataDir, workDir }) => {
  const root = path.join(workDir, 'Crashy.vrs');
  await stubFolderDialogs(electronApp, root);
  await window.getByRole('button', { name: 'New project…' }).click();
  await addDocument(window, 'Draft', 'saved text');
  await window.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(window.getByText('Saved', { exact: true })).toBeVisible();

  await window.getByRole('textbox', { name: 'Document text' }).fill('text that was never saved');
  const recoveryDir = path.join(userDataDir, 'recovery');
  await expect.poll(async () => (await fs.readdir(recoveryDir).catch(() => [])).length, { timeout: 10_000 }).toBe(1);

  await crashApp(electronApp);
  const relaunched = await launchApp(userDataDir);
  try {
    const w = relaunched.window;
    await w.getByRole('button', { name: 'Open Crashy' }).click();
    await w.getByRole('button', { name: 'Restore' }).click();
    await w.getByRole('treeitem', { name: 'Draft' }).click();
    await expect(w.getByRole('textbox', { name: 'Document text' })).toHaveValue('text that was never saved');
    await expect(w.getByText('Unsaved changes')).toBeVisible();

    await w.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(w.getByText('Saved', { exact: true })).toBeVisible();
    expect(await fs.readdir(recoveryDir)).toEqual([]);
  } finally {
    await quitApp(relaunched.app);
  }
});

test('closing the window with unsaved changes can save first', async ({ electronApp, window, workDir }) => {
  const root = path.join(workDir, 'Closing.vrs');
  await stubFolderDialogs(electronApp, root);
  await window.getByRole('button', { name: 'New project…' }).click();
  await addDocument(window, 'Last words', 'saved on the way out');
  await stubMessageBox(electronApp, 0); // "Save"

  const exited = new Promise(resolve => electronApp.process().once('exit', resolve));
  await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
  await exited;

  const id = await docIdFor(root, 'Last words');
  expect(await fs.readFile(path.join(root, 'docs', `${id}.md`), 'utf-8')).toBe('saved on the way out');
});

test('the renderer cannot open an arbitrary folder as a project', async ({ window, workDir }) => {
  const result = await window.evaluate(
    (folder) => (window as unknown as { vrs: VrsApi }).vrs.project.openRecent(folder),
    workDir,
  );
  expect(result).toEqual({ ok: false, error: { code: 'NOT_RECENT', message: expect.any(String) } });

  const read = await window.evaluate(() => (window as unknown as { vrs: VrsApi }).vrs.project.readDoc('x'));
  expect(read).toMatchObject({ ok: false, error: { code: 'NO_PROJECT' } });
});
