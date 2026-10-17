import fs from 'fs/promises';
import path from 'path';
import type { ElectronApplication, Page } from 'playwright/test';
import { test, expect, launchApp, quitApp, stubFolderDialogs } from '../electron-launch';

const readJson = async (p: string) => JSON.parse(await fs.readFile(p, 'utf-8'));

async function createProject(electronApp: ElectronApplication, window: Page, root: string) {
  await stubFolderDialogs(electronApp, root);
  await window.getByRole('button', { name: 'New project…' }).click();
  await expect(window.getByRole('textbox', { name: 'Project name' })).toBeVisible();
}

async function save(window: Page) {
  await window.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(window.getByText('Saved', { exact: true })).toBeVisible();
}

async function addEntity(window: Page, title: string, kind: string) {
  await window.getByRole('button', { name: 'New item' }).click();
  const dialog = window.getByRole('dialog', { name: 'Add to binder' });
  await dialog.getByRole('radio', { name: 'Entity' }).click();
  await dialog.getByRole('textbox', { name: 'Title' }).fill(title);
  await dialog.getByLabel('Kind').selectOption({ label: kind });
  await dialog.getByRole('button', { name: 'Create' }).click();
  await expect(window.getByTestId('entity-panel')).toBeVisible();
}

async function addPlainFact(window: Page, attribute: string, value: string) {
  const panel = window.getByTestId('entity-panel');
  await panel.getByRole('button', { name: 'Add fact' }).click();
  await panel.getByLabel('Attribute', { exact: true }).fill(attribute);
  await panel.getByRole('textbox', { name: 'Value' }).fill(value);
  await panel.getByRole('button', { name: 'Save fact' }).click();
}

async function addWhen(window: Page, season: number, episode: number) {
  const panel = window.getByTestId('entity-panel');
  await panel.getByRole('button', { name: 'Add fact' }).click();
  await panel.getByLabel('Attribute', { exact: true }).fill('when');
  await panel.getByRole('spinbutton', { name: 'Season' }).fill(String(season));
  await panel.getByRole('spinbutton', { name: 'Episode' }).fill(String(episode));
  await panel.getByRole('button', { name: 'Save fact' }).click();
}

const openItem = (window: Page, name: string) => window.getByRole('treeitem', { name, exact: true }).click();

test('captures from a chat, resolves a contradiction, and keeps the decision across a restart', async ({ electronApp, window, userDataDir, workDir }) => {
  const root = path.join(workDir, 'Story.vrs');
  await createProject(electronApp, window, root);

  await window.getByRole('button', { name: 'Import chat' }).click();
  const importDialog = window.getByRole('dialog', { name: 'Import chat' });
  await importDialog.getByRole('textbox', { name: 'Title' }).fill('Plot chat');
  await importDialog.getByRole('textbox', { name: 'Chat text' }).fill('You: what happens?\r\nBot: Mira dies in the season 3 finale.\r\nYou: ok\r\n');
  await importDialog.getByRole('button', { name: 'Import' }).click();

  const transcript = window.getByLabel('Chat transcript');
  await expect(transcript).toContainText('Mira dies');
  await transcript.evaluate((pre) => {
    const node = pre.firstChild as Text;
    const start = (node.textContent ?? '').indexOf('Mira dies');
    const range = document.createRange();
    range.setStart(node, start);
    range.setEnd(node, start + 'Mira dies'.length);
    const sel = document.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  });

  const popover = window.getByRole('dialog', { name: 'Capture fact' });
  await popover.getByLabel('Entity', { exact: true }).selectOption({ label: 'New entity…' });
  await popover.getByRole('textbox', { name: 'New entity name' }).fill('Mira');
  await popover.getByLabel('Attribute', { exact: true }).fill('death');
  await popover.getByRole('textbox', { name: 'Value' }).fill('Season 3 finale');
  await popover.getByRole('button', { name: 'Save fact' }).click();

  await openItem(window, 'Mira');
  await addPlainFact(window, 'death', 'Season 5');

  const conflicts = window.getByRole('button', { name: /^Conflicts/ });
  await expect(conflicts.getByLabel('1 open')).toBeVisible();
  await conflicts.click();
  await window.getByRole('article').filter({ hasText: 'Season 3 finale' }).getByRole('button', { name: 'Keep this one' }).click();
  await expect(conflicts.getByLabel('0 open')).toBeVisible();
  await save(window);

  const bible = await readJson(path.join(root, 'bible', 'bible.json'));
  expect(bible.facts.filter((f: { status: string }) => f.status === 'kept')).toHaveLength(1);
  expect(bible.facts.filter((f: { status: string }) => f.status === 'set_aside')).toHaveLength(1);
  expect(bible.decisions).toHaveLength(1);
  expect(bible.decisions[0]).toMatchObject({ kind: 'kept_one' });

  await quitApp(electronApp);
  const relaunched = await launchApp(userDataDir);
  try {
    const w = relaunched.window;
    await w.getByRole('button', { name: 'Open Story' }).click();
    const badge = w.getByRole('button', { name: /^Conflicts/ });
    await expect(badge.getByLabel('0 open')).toBeVisible();
    await badge.click();
    await w.getByRole('button', { name: 'Decided' }).click();
    const queue = w.getByRole('complementary', { name: 'Contradictions' });
    await expect(queue).toContainText('Mira · death');
    await expect(queue).toContainText('Kept one');
  } finally {
    await quitApp(relaunched.app);
  }
});

test('shows events in story order and flags one that breaks its dependencies', async ({ electronApp, window, workDir }) => {
  await createProject(electronApp, window, path.join(workDir, 'Timeline.vrs'));

  await addEntity(window, 'Hal dies', 'Event');
  await addWhen(window, 3, 4);
  await addEntity(window, 'Ren joins', 'Event');
  await addWhen(window, 4, 1);
  await addEntity(window, 'Mira dies', 'Event');
  await addWhen(window, 5, 2);

  // Mira dies after Hal dies; Ren joins after Mira dies (but is placed before her).
  await window.getByTestId('entity-panel').getByLabel('Add dependency').selectOption({ label: 'Hal dies' });
  await openItem(window, 'Ren joins');
  await window.getByTestId('entity-panel').getByLabel('Add dependency').selectOption({ label: 'Mira dies' });

  await window.getByRole('button', { name: 'Timeline' }).first().click();
  const miraRow = window.getByRole('region', { name: 'Season 5' }).getByRole('button', { name: /Mira dies/ });
  await expect(miraRow).toContainText('✗');
  await expect(miraRow).toContainText('Out of order');

  const s3 = await window.getByRole('heading', { name: 'Season 3' }).boundingBox();
  const s4 = await window.getByRole('heading', { name: 'Season 4' }).boundingBox();
  expect(s3 && s4 && s3.y < s4.y).toBe(true);
});
