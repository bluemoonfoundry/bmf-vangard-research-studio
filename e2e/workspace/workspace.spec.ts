import fs from 'fs/promises';
import path from 'path';
import type { ElectronApplication, Page } from 'playwright/test';
import {
  test, expect, openedUrls, stubFolderDialogs, stubOpenExternal, stubOpenFile, stubSaveFile,
} from '../electron-launch';

// A 2x1 PNG, so the rendered image has a real size.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAAEUlEQVR42mP8z8DwnwEIGGEMAEqvB/0zFdPhAAAAAElFTkSuQmCC',
  'base64',
);

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

test('imports an image into assets/, shows it, and deletes the file with the item', async ({ electronApp, window, workDir }) => {
  const root = path.join(workDir, 'Media.vrs');
  await createProject(electronApp, window, root);
  const picked = path.join(workDir, 'Harbour chart.png');
  await fs.writeFile(picked, PNG);

  await window.getByRole('button', { name: 'New item' }).click();
  const dialog = window.getByRole('dialog', { name: 'Add to binder' });
  await dialog.getByRole('radio', { name: 'Image' }).click();
  await stubOpenFile(electronApp, picked);
  await dialog.getByRole('button', { name: 'Choose file…' }).click();
  await expect(dialog.getByRole('textbox', { name: 'Title' })).toHaveValue('Harbour chart');
  await dialog.getByRole('button', { name: 'Create' }).click();

  // Streamed over vrs-asset:, which the CSP allows; the renderer never touches the file path.
  const image = window.getByRole('img', { name: 'Harbour chart' });
  await expect(image).toHaveAttribute('src', /^vrs-asset:\/\/project\//);
  await expect.poll(() => image.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(2);
  await expect(window.getByText('2 × 1 px')).toBeVisible();

  await save(window);
  const [item] = (await readJson(path.join(root, 'tree.json'))).items;
  expect(item).toMatchObject({ type: 'image', title: 'Harbour chart', asset: expect.stringMatching(/\.png$/) });
  expect(await fs.readFile(path.join(root, 'assets', item.asset))).toEqual(PNG);

  await window.getByRole('tree', { name: 'Binder items' }).getByRole('button', { name: 'Delete Harbour chart' }).click();
  await window.getByRole('dialog', { name: 'Delete item' }).getByRole('button', { name: 'Delete' }).click();
  await save(window);
  expect(await fs.readdir(path.join(root, 'assets'))).toEqual([]);
});

/** `seconds` of 8 kHz, 8-bit mono silence. */
function wav(seconds: number): Buffer {
  const samples = 8000 * seconds;
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + samples, 4);
  header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(8000, 24);
  header.writeUInt32LE(8000, 28);
  header.writeUInt16LE(1, 32);
  header.writeUInt16LE(8, 34);
  header.write('data', 36);
  header.writeUInt32LE(samples, 40);
  return Buffer.concat([header, Buffer.alloc(samples, 0x80)]);
}

test('streams imported audio from the project with range requests', async ({ electronApp, window, workDir }) => {
  const root = path.join(workDir, 'Audio.vrs');
  await createProject(electronApp, window, root);
  const picked = path.join(workDir, 'Interview.wav');
  const bytes = wav(3);
  await fs.writeFile(picked, bytes);

  await window.getByRole('button', { name: 'New item' }).click();
  const dialog = window.getByRole('dialog', { name: 'Add to binder' });
  await dialog.getByRole('radio', { name: 'Audio' }).click();
  await stubOpenFile(electronApp, picked);
  await dialog.getByRole('button', { name: 'Choose file…' }).click();
  await dialog.getByRole('button', { name: 'Create' }).click();

  const player = window.getByRole('region', { name: 'Audio player' });
  await expect(player.getByText('0:00 / 0:03')).toBeVisible();
  const src = await player.locator('audio').getAttribute('src');
  expect(src).toMatch(/^vrs-asset:\/\/project\/[^/]+\.wav\?v=0$/);

  // The main process serves byte ranges of the file; the renderer never holds it whole.
  const ranged = await electronApp.evaluate(async ({ net }, url) => {
    const res = await net.fetch(url, { headers: { Range: 'bytes=0-3' } });
    return { status: res.status, range: res.headers.get('content-range'), type: res.headers.get('content-type'), text: await res.text() };
  }, src!);
  expect(ranged).toEqual({ status: 206, range: `bytes 0-3/${bytes.length}`, type: 'audio/wav', text: 'RIFF' });

  const outside = await electronApp.evaluate(async ({ net }) => (await net.fetch('vrs-asset://project/..%2Fvrs.json')).status);
  expect(outside).toBe(404);
});

test('organises research in folders and exports a Markdown dossier', async ({ electronApp, window, workDir }) => {
  const root = path.join(workDir, 'Dossier.vrs');
  await createProject(electronApp, window, root);

  await window.getByRole('button', { name: 'New folder' }).click();
  await window.getByRole('button', { name: 'Document', exact: true }).click();
  await window.getByRole('textbox', { name: 'Document title' }).fill('People');
  await window.getByRole('button', { name: 'Corkboard' }).click();
  await window.getByRole('button', { name: 'New card' }).first().click();
  await window.getByRole('textbox', { name: 'Document title' }).fill('Ada');
  await window.getByRole('textbox', { name: 'Synopsis', exact: true }).fill('Navigator of the Kestrel');
  await window.getByRole('textbox', { name: 'Document text' }).fill('Charts the **northern** coast.');
  await window.getByRole('complementary', { name: 'Inspector' }).getByRole('combobox', { name: 'Label' }).selectOption('character');

  await expect(window.getByRole('treeitem', { name: 'Ada' })).toHaveAttribute('aria-level', '2');

  const exported = path.join(workDir, 'out', 'dossier.md');
  await fs.mkdir(path.dirname(exported));
  await stubSaveFile(electronApp, exported);
  await window.getByRole('button', { name: 'Export' }).click();
  const dialog = window.getByRole('dialog', { name: 'Export research dossier' });
  await dialog.getByRole('button', { name: /Save as Markdown/ }).click();
  await expect(dialog.getByRole('status')).toContainText(exported);

  const markdown = await fs.readFile(exported, 'utf-8');
  expect(markdown).toContain('## People');
  expect(markdown).toContain('### Ada');
  expect(markdown).toContain('**Label:** Character');
  expect(markdown).toContain('> Navigator of the Kestrel\n\nCharts the **northern** coast.');
});

test('web clips and preview links open in the system browser, never in the app window', async ({ electronApp, window, workDir }) => {
  await createProject(electronApp, window, path.join(workDir, 'Links.vrs'));
  await stubOpenExternal(electronApp);

  await window.getByRole('button', { name: 'New item' }).click();
  const dialog = window.getByRole('dialog', { name: 'Add to binder' });
  await dialog.getByRole('radio', { name: 'Web clip' }).click();
  await dialog.getByRole('textbox', { name: 'Title' }).fill('Tide tables');
  await dialog.getByRole('textbox', { name: 'Source URL' }).fill('https://tides.example/1684');
  await dialog.getByRole('button', { name: 'Create' }).click();
  await window.getByRole('button', { name: 'Open in browser' }).click();

  await window.getByRole('textbox', { name: 'Document text' }).fill('See [the archive](https://archive.example/a).\n\n<img src=x onerror="document.title=\'pwned\'">');
  await window.getByRole('button', { name: 'Preview' }).click();
  await window.getByRole('link', { name: 'the archive' }).click();

  await expect.poll(() => openedUrls(electronApp)).toEqual(['https://tides.example/1684', 'https://archive.example/a']);
  await expect(window.getByRole('heading', { name: 'Vangard Research Studio' })).toBeVisible();
  expect(await window.title()).not.toBe('pwned');
});
