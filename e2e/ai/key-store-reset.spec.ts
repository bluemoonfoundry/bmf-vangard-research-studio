import fs from 'fs/promises';
import path from 'path';
import { aiTest as test, expect, launchApp, quitApp } from '../electron-launch';

const KEY = 'AIza-e2e-fake-key-reset-5b2e';

test('a corrupt key store can be reset from Settings', async ({ userDataDir, fakeProvider }) => {
  // Written before launch, so the first status read already sees it.
  const keyFile = path.join(userDataDir, 'ai-keys.json');
  await fs.writeFile(keyFile, '{ corrupt', 'utf-8');
  const { app, window } = await launchApp(userDataDir, { llmBaseUrl: fakeProvider.baseUrl });
  try {
    await window.getByRole('button', { name: 'Settings', exact: true }).click();
    const dialog = window.getByRole('dialog', { name: 'Settings' });
    const problem = dialog.getByRole('alert').filter({ hasText: 'could not be read' });
    await expect(problem).toBeVisible();

    await problem.getByRole('button', { name: 'Reset stored keys' }).click();
    const confirm = window.getByRole('dialog', { name: 'Reset stored keys' });
    await confirm.getByRole('button', { name: 'Reset stored keys' }).click();
    await expect(problem).toBeHidden();

    const backups = (await fs.readdir(userDataDir)).filter(f => f.startsWith('ai-keys.json.corrupt-'));
    expect(backups).toHaveLength(1);
    expect(await fs.readFile(path.join(userDataDir, backups[0]), 'utf-8')).toBe('{ corrupt');

    // Keys can be saved again afterwards.
    const gemini = dialog.getByRole('listitem').filter({ has: window.getByRole('heading', { name: 'Google Gemini' }) });
    await gemini.getByLabel('Google Gemini API key').fill(KEY);
    await gemini.getByRole('button', { name: 'Save & test' }).click();
    await expect(gemini).toContainText('Key saved · tested');
    expect(await fs.readFile(keyFile, 'utf-8')).not.toContain(KEY);
  } finally {
    await quitApp(app);
  }
});
