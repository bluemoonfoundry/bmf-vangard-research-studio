import fs from 'fs/promises';
import path from 'path';
import type { ElectronApplication, Page } from 'playwright/test';
import { aiTest as test, expect, stubFolderDialogs, stubMessageBox } from '../electron-launch';
import { extractionReply } from '../fakeProvider';

const KEY = 'AIza-e2e-fake-key-extract-5c1e';
const NOTES = 'Ivo is the harbour master of Sky Harbour. He lost an eye in the storm.';

const readJson = async (p: string) => JSON.parse(await fs.readFile(p, 'utf-8'));

async function createProject(electronApp: ElectronApplication, window: Page, root: string) {
  await stubFolderDialogs(electronApp, root);
  await stubMessageBox(electronApp, 1);
  await window.getByRole('button', { name: 'New project…' }).click();
  await expect(window.getByRole('textbox', { name: 'Project name' })).toBeVisible();
}

async function save(window: Page) {
  await window.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(window.getByText('Saved', { exact: true })).toBeVisible();
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

async function addNotes(window: Page) {
  await window.getByRole('button', { name: 'New document' }).click();
  await window.getByRole('textbox', { name: 'Document title' }).fill('Harbour notes');
  await window.getByRole('textbox', { name: 'Document text' }).fill(NOTES);
}

const IVO = { id: '', name: 'Ivo', kind: 'character', reason: 'The harbour master, central to the notes.' };
const REPLY = extractionReply({
  proposals: [
    { entity: IVO, attribute: 'role', value: 'harbour master', strength: 'said', evidence: [{ quote: 'Ivo is the harbour master of Sky Harbour.', turn: 1 }], replaces: '' },
    { entity: IVO, attribute: 'injury', value: 'lost an eye', strength: 'said', evidence: [{ quote: 'He lost an eye in the storm', turn: 1 }], replaces: '' },
  ],
  summary: 'Ivo: harbour master, lost an eye.',
});

test('no extraction UI while AI is off', async ({ electronApp, window, workDir }) => {
  await createProject(electronApp, window, path.join(workDir, 'Off.vrs'));
  await addNotes(window);
  await expect(window.getByRole('button', { name: 'Extract', exact: true })).toHaveCount(0);
  await expect(window.getByRole('button', { name: /^Review/ })).toHaveCount(0);
});

test('extracts a new card from notes, reviews it into canon, and reuses the cache', async ({ electronApp, window, workDir, fakeProvider }) => {
  const root = path.join(workDir, 'Harbour.vrs');
  await createProject(electronApp, window, root);
  await enableAi(window);
  await addNotes(window);
  fakeProvider.setReply(REPLY);

  await window.getByRole('button', { name: 'Extract', exact: true }).click();
  const dialog = window.getByRole('dialog', { name: 'Extract facts' });
  await expect(dialog.getByRole('checkbox', { name: 'Harbour notes', exact: true })).toBeChecked();
  await expect(dialog.getByText(/No turns found/)).toBeVisible();
  await dialog.getByRole('checkbox', { name: 'Harbour notes is my own writing' }).check();
  await expect(dialog.getByText(/1 source · ~[\d,]+ tokens · 0 cached · Gemini 2\.5 Flash/)).toBeVisible();
  await dialog.getByRole('button', { name: 'Start' }).click();
  await expect(dialog.getByText('In all: 2 to review · 1 new card')).toBeVisible();

  // The request asked Gemini for JSON matching the schema; the key never left the main process.
  expect(fakeProvider.streams).toHaveLength(1);
  const body = fakeProvider.streams[0].body as { generationConfig: { responseMimeType: string; responseJsonSchema: { type: string } } };
  expect(body.generationConfig.responseMimeType).toBe('application/json');
  expect(body.generationConfig.responseJsonSchema.type).toBe('object');
  expect(await window.evaluate(() => document.documentElement.outerHTML)).not.toContain(KEY);

  await dialog.getByRole('button', { name: 'Review' }).click();
  const card = window.getByRole('region', { name: 'New card: Ivo' });
  await expect(card.getByText(IVO.reason)).toBeVisible();
  await expect(card.getByRole('listitem')).toHaveCount(2);
  await card.getByRole('button', { name: 'Approve' }).click();
  await expect(window.getByRole('treeitem', { name: 'Ivo' })).toBeVisible();

  const group = window.getByRole('region', { name: 'Ivo' });
  const role = group.getByRole('listitem').filter({ hasText: 'harbour master' });
  await expect(role.getByText('You said this')).toBeVisible();
  await role.getByRole('button', { name: 'Keep' }).click();
  await group.getByRole('listitem').filter({ hasText: 'lost an eye' }).getByRole('button', { name: 'Set aside' }).click();
  await expect(window.getByText('Nothing to review.')).toBeVisible();

  await window.getByRole('button', { name: 'Cards', exact: true }).click();
  await expect(window.getByRole('list', { name: 'Cards' }).getByRole('button', { name: /^Ivo/ })).toContainText('harbour master');

  // Same source, same model: the cached results are applied again, no request, nothing comes back.
  await window.getByRole('button', { name: 'Extract', exact: true }).click();
  await window.getByRole('dialog', { name: 'Extract facts' }).getByRole('checkbox', { name: 'Harbour notes', exact: true }).check();
  await expect(dialog.getByText(/1 cached/)).toBeVisible();
  await dialog.getByRole('button', { name: 'Start' }).click();
  await expect(dialog.getByText(/From the last run/)).toBeVisible();
  expect(fakeProvider.streams).toHaveLength(1);
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(window.getByRole('button', { name: /^Review/ }).getByLabel('0 to review')).toBeVisible();

  await save(window);
  const extraction = await readJson(path.join(root, 'bible', 'extraction.json'));
  expect(extraction.cards).toEqual([]);
  expect(extraction.runs).toHaveLength(1);
  const bible = await readJson(path.join(root, 'bible', 'bible.json'));
  expect(bible.facts.map((f: { value: string; status: string; origin: string }) => [f.value, f.status, f.origin]).sort())
    .toEqual([['harbour master', 'kept', 'ai'], ['lost an eye', 'set_aside', 'ai']]);
});
