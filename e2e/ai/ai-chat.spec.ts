import fs from 'fs/promises';
import path from 'path';
import type { ElectronApplication, Page } from 'playwright/test';
import { aiTest as test, expect, stubFolderDialogs, stubMessageBox } from '../electron-launch';

/** Distinctive, so a leak anywhere is easy to spot. The fake provider accepts any non-empty key. */
const KEY = 'AIza-e2e-fake-key-7f3a91c2d4';
const CHAT = 'Research chat';

const readJson = async (p: string) => JSON.parse(await fs.readFile(p, 'utf-8'));

async function idFor(root: string, title: string): Promise<string> {
  const tree = await readJson(path.join(root, 'tree.json'));
  return tree.items.find((i: { title: string }) => i.title === title).id;
}

async function createProject(electronApp: ElectronApplication, window: Page, root: string) {
  await stubFolderDialogs(electronApp, root);
  // Closing with unsaved work answers "Don't Save" rather than showing a real dialog.
  await stubMessageBox(electronApp, 1);
  await window.getByRole('button', { name: 'New project…' }).click();
  await expect(window.getByRole('textbox', { name: 'Project name' })).toBeVisible();
}

async function save(window: Page) {
  await window.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(window.getByText('Saved', { exact: true })).toBeVisible();
}

/** Settings → paste key → Save & test → Enable → default Gemini model from the fake's list. */
async function enableAi(window: Page) {
  await window.getByRole('button', { name: 'Settings', exact: true }).click();
  const dialog = window.getByRole('dialog', { name: 'Settings' });
  const gemini = dialog.getByRole('listitem').filter({ has: window.getByRole('heading', { name: 'Google Gemini' }) });
  await gemini.getByLabel('Google Gemini API key').fill(KEY);
  await gemini.getByRole('button', { name: 'Save & test' }).click();
  await expect(gemini).toContainText('Key saved · tested');
  await expect(gemini.getByLabel('Google Gemini API key')).toHaveValue('');

  const enable = dialog.getByRole('checkbox', { name: 'Enable AI features' });
  await expect(enable).toBeEnabled();
  await enable.click();
  await expect(enable).toBeChecked();

  await dialog.getByLabel('Default provider').selectOption({ label: 'Google Gemini' });
  const model = dialog.getByLabel('Default model');
  // The fake lists an embedding model too; only generateContent models are offered.
  await expect(model.locator('option')).toHaveText(['None', 'Gemini 2.5 Flash', 'Gemini 2.5 Pro']);
  await model.selectOption({ label: 'Gemini 2.5 Flash' });
  await expect(model).toHaveValue('gemini-2.5-flash');
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(dialog).toBeHidden();
}

async function addAiChat(window: Page, title = CHAT) {
  await window.getByRole('button', { name: 'New item' }).click();
  const dialog = window.getByRole('dialog', { name: 'Add to binder' });
  await dialog.getByRole('radio', { name: 'AI Chat' }).click();
  await dialog.getByRole('textbox', { name: 'Title' }).fill(title);
  await dialog.getByRole('button', { name: 'Create' }).click();
  await expect(window.getByRole('textbox', { name: 'Chat title' })).toHaveValue(title);
  await expect(window.getByRole('combobox', { name: 'Model' })).toHaveValue('gemini-2.5-flash');
}

async function send(window: Page, text: string) {
  await window.getByRole('textbox', { name: 'Message' }).fill(text);
  await window.getByRole('button', { name: 'Send' }).click();
}

const aiMessage = (window: Page) => window.getByRole('article', { name: /^AI:/ });
const chatRow = (window: Page) => window.getByRole('treeitem', { name: new RegExp(`^${CHAT}`) });

/** Everything up to an open AI chat in a new project with AI on. */
async function setUpChat(electronApp: ElectronApplication, window: Page, root: string) {
  await createProject(electronApp, window, root);
  await enableAi(window);
  await addAiChat(window);
}

test('no AI UI while AI is off', async ({ electronApp, window, workDir, fakeProvider }) => {
  await createProject(electronApp, window, path.join(workDir, 'Off.vrs'));

  await window.getByRole('button', { name: 'New item' }).click();
  const dialog = window.getByRole('dialog', { name: 'Add to binder' });
  await expect(dialog.getByRole('radio', { name: 'Document' })).toBeVisible();
  await expect(dialog.getByRole('radio', { name: 'AI Chat' })).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Cancel' }).click();

  await expect(window.getByRole('combobox', { name: 'Model' })).toHaveCount(0);
  await expect(window.getByRole('combobox', { name: 'Provider' })).toHaveCount(0);
  await expect(window.getByRole('textbox', { name: 'Message' })).toHaveCount(0);

  // Settings can't switch AI on without a tested key.
  await window.getByRole('button', { name: 'Settings', exact: true }).click();
  const settings = window.getByRole('dialog', { name: 'Settings' });
  await expect(settings.getByRole('checkbox', { name: 'Enable AI features' })).toBeDisabled();
  await expect(settings.getByText('Add and test an API key first')).toBeVisible();
  await settings.getByRole('button', { name: 'Close', exact: true }).click();

  // Nothing was sent anywhere.
  expect(fakeProvider.keys).toEqual([]);
  expect(fakeProvider.streams).toEqual([]);
});

test('enable flow', async ({ electronApp, window, workDir, fakeProvider }) => {
  await createProject(electronApp, window, path.join(workDir, 'Enable.vrs'));
  await enableAi(window);
  expect(fakeProvider.keys).toContain(KEY);

  await window.getByRole('button', { name: 'New item' }).click();
  await expect(window.getByRole('dialog', { name: 'Add to binder' }).getByRole('radio', { name: 'AI Chat' })).toBeVisible();
});

test('chat round trip', async ({ electronApp, window, workDir, fakeProvider }) => {
  const root = path.join(workDir, 'Story.vrs');
  await setUpChat(electronApp, window, root);
  fakeProvider.setReply(['Spain ', 'won ', 'Euro 2024.']);
  fakeProvider.setDelay(50);

  await send(window, 'Who won Euro 2024?');
  await expect(window.getByRole('article', { name: /^You:/ })).toContainText('Who won Euro 2024?');
  const reply = aiMessage(window);
  await expect(reply).toContainText('Spain won Euro 2024.');
  await expect(reply).toContainText('Google Gemini · gemini-2.5-flash');
  await expect(reply.getByText('Replying…')).toHaveCount(0);

  expect(fakeProvider.streams).toHaveLength(1);
  expect(fakeProvider.streams[0]).toMatchObject({ model: 'gemini-2.5-flash', key: KEY });

  await save(window);
  const id = await idFor(root, CHAT);
  const file = await readJson(path.join(root, 'chats', `${id}.json`));
  expect(file.version).toBe(1);
  expect(file.settings).toMatchObject({ provider: 'gemini', model: 'gemini-2.5-flash' });
  expect(file.messages).toHaveLength(2);
  expect(file.messages[0]).toMatchObject({ role: 'user', text: 'Who won Euro 2024?' });
  expect(file.messages[1]).toMatchObject({ role: 'assistant', text: 'Spain won Euro 2024.', status: 'complete', provider: 'gemini', model: 'gemini-2.5-flash' });

  await window.getByRole('button', { name: 'Close project' }).click();
  await window.getByRole('button', { name: 'Open Story' }).click();
  await chatRow(window).click();
  await expect(window.getByRole('article', { name: /^You:/ })).toContainText('Who won Euro 2024?');
  await expect(aiMessage(window)).toContainText('Spain won Euro 2024.');
  await expect(aiMessage(window)).toContainText('Google Gemini · gemini-2.5-flash');
});

test('reply keeps streaming in the background', async ({ electronApp, window, workDir, fakeProvider }) => {
  await setUpChat(electronApp, window, path.join(workDir, 'Background.vrs'));
  fakeProvider.setReply(['The harbour ', 'closed in 1684.']);
  fakeProvider.hold();

  await send(window, 'When did the harbour close?');
  await expect(aiMessage(window)).toContainText('The harbour');
  await expect(chatRow(window)).toContainText('replying…');

  // Leave the chat while the reply is still coming.
  await window.getByRole('button', { name: 'New document' }).click();
  await expect(window.getByRole('textbox', { name: 'Document text' })).toBeVisible();
  await expect(chatRow(window)).toContainText('replying…');

  fakeProvider.release();
  await expect(chatRow(window)).not.toContainText('replying…');

  await chatRow(window).click();
  const reply = aiMessage(window);
  await expect(reply).toContainText('The harbour closed in 1684.');
  await expect(reply.getByText('Replying…')).toHaveCount(0);
  await expect(reply.getByText('Stopped')).toHaveCount(0);
});

test('stop keeps partial text as cancelled', async ({ electronApp, window, workDir, fakeProvider }) => {
  const root = path.join(workDir, 'Stop.vrs');
  await setUpChat(electronApp, window, root);
  fakeProvider.setReply(['Half an ', 'answer that never arrives.']);
  fakeProvider.hold();

  await send(window, 'Tell me everything.');
  const reply = aiMessage(window);
  await expect(reply).toContainText('Half an');
  await window.getByRole('button', { name: 'Stop' }).click();

  await expect(reply.getByText('Stopped')).toBeVisible();
  await expect(reply).toContainText('Half an');
  await expect(window.getByRole('button', { name: 'Send' })).toBeVisible();
  await expect(chatRow(window)).not.toContainText('replying…');
  fakeProvider.release();
  await expect(reply).not.toContainText('never arrives');

  await save(window);
  const file = await readJson(path.join(root, 'chats', `${await idFor(root, CHAT)}.json`));
  expect(file.messages[1]).toMatchObject({ role: 'assistant', text: 'Half an ', status: 'cancelled' });
});

test('capture a fact from an AI message and follow its source', async ({ electronApp, window, workDir, fakeProvider }) => {
  await setUpChat(electronApp, window, path.join(workDir, 'Capture.vrs'));
  fakeProvider.setReply(['Mira was born ', 'in Harbourtown.']);
  await send(window, 'Where was Mira born?');
  const reply = aiMessage(window);
  await expect(reply).toContainText('Mira was born in Harbourtown.');
  await expect(reply.getByText('Replying…')).toHaveCount(0);

  // Select "Harbourtown" in the rendered message, as a mouse drag would.
  await reply.evaluate((article, word) => {
    const walker = document.createTreeWalker(article, NodeFilter.SHOW_TEXT);
    let node: Node | null;
    while ((node = walker.nextNode())) {
      const at = (node.textContent ?? '').indexOf(word);
      if (at < 0 || node.parentElement?.closest('header')) continue;
      const range = document.createRange();
      range.setStart(node, at);
      range.setEnd(node, at + word.length);
      const sel = document.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
      document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
      return;
    }
    throw new Error(`"${word}" is not in the message`);
  }, 'Harbourtown');

  const popover = window.getByRole('dialog', { name: 'Capture fact' });
  await popover.getByLabel('Entity', { exact: true }).selectOption({ label: 'New entity…' });
  await popover.getByRole('textbox', { name: 'New entity name' }).fill('Mira');
  await popover.getByLabel('Attribute', { exact: true }).fill('birthplace');
  await popover.getByRole('textbox', { name: 'Value' }).fill('Harbourtown');
  await popover.getByRole('button', { name: 'Save fact' }).click();
  await expect(popover).toBeHidden();

  await window.getByRole('treeitem', { name: 'Mira', exact: true }).click();
  const panel = window.getByTestId('entity-panel');
  await expect(panel).toContainText('Harbourtown');
  await panel.getByRole('button', { name: CHAT, exact: true }).click();

  // The cited message opens raw with the quote marked.
  const raw = window.getByLabel('Raw message text');
  await expect(raw).toContainText('Mira was born in Harbourtown.');
  await expect(raw.locator('mark')).toHaveText('Harbourtown');
});

test('external edit of a chat file reloads a clean chat', async ({ electronApp, window, workDir, fakeProvider }) => {
  const root = path.join(workDir, 'External.vrs');
  await setUpChat(electronApp, window, root);
  fakeProvider.setReply(['Written ', 'by the AI.']);
  await send(window, 'Say something.');
  await expect(aiMessage(window)).toContainText('Written by the AI.');
  await expect(aiMessage(window).getByText('Replying…')).toHaveCount(0);
  await save(window);

  const file = path.join(root, 'chats', `${await idFor(root, CHAT)}.json`);
  const transcript = await readJson(file);
  transcript.messages[1].text = 'Rewritten in another editor.';
  await fs.writeFile(file, JSON.stringify(transcript, null, 2));

  await expect(aiMessage(window)).toContainText('Rewritten in another editor.');
  await expect(window.getByText('Saved', { exact: true })).toBeVisible();
  expect(fakeProvider.streams).toHaveLength(1);
});

test('key never reaches the renderer', async ({ electronApp, window, workDir, userDataDir, fakeProvider }) => {
  await setUpChat(electronApp, window, path.join(workDir, 'Secret.vrs'));
  fakeProvider.setReply(['A reply.']);
  await send(window, 'Hello?');
  await expect(aiMessage(window)).toContainText('A reply.');
  // The key really was used, by the main process.
  expect(fakeProvider.keys.every(k => k === KEY)).toBe(true);
  expect(fakeProvider.keys.length).toBeGreaterThan(0);

  const seen = await window.evaluate(async () => {
    const ai = self.vrs!.ai;
    return JSON.stringify([
      await ai.getSettings(),
      await ai.testKey('gemini'),
      await ai.listModels('gemini', { refresh: true }),
      document.documentElement.outerHTML,
      { ...localStorage },
      { ...sessionStorage },
    ]);
  });
  expect(seen).toContain('gemini-2.5-flash');
  expect(seen).not.toContain(KEY);

  // Nor does it sit in plain text on disk.
  for (const name of await fs.readdir(userDataDir, { recursive: true })) {
    const p = path.join(userDataDir, String(name));
    if (!(await fs.stat(p)).isFile() || !/\.json$/.test(p)) continue;
    expect(await fs.readFile(p, 'utf-8'), p).not.toContain(KEY);
  }
});
