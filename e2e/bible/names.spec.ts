import path from 'path';
import type { Page } from 'playwright/test';
import { test, expect, stubFolderDialogs } from '../electron-launch';

async function startCharacter(window: Page, title: string) {
  await window.getByRole('button', { name: 'New item' }).click();
  const dialog = window.getByRole('dialog', { name: 'Add to binder' });
  await dialog.getByRole('radio', { name: 'Entity' }).click();
  await dialog.getByRole('textbox', { name: 'Title' }).fill(title);
  await dialog.getByLabel('Kind').selectOption({ label: 'Character' });
  return dialog;
}

test('characters sharing a surname are pointed out and linked', async ({ electronApp, window, workDir }) => {
  await stubFolderDialogs(electronApp, path.join(workDir, 'Names.vrs'));
  await window.getByRole('button', { name: 'New project…' }).click();
  await expect(window.getByRole('textbox', { name: 'Project name' })).toBeVisible();

  await (await startCharacter(window, 'Anna Smith')).getByRole('button', { name: 'Create' }).click();
  const dialog = await startCharacter(window, 'Ben Smith');
  await expect(dialog.getByText('Another character is also called "Smith": Anna Smith.')).toBeVisible();
  await dialog.getByRole('button', { name: 'Create' }).click();

  const shared = window.getByTestId('entity-panel').getByRole('list', { name: 'Shared names' });
  await expect(shared).toContainText('Shares "Smith" with Anna Smith');
  await shared.getByRole('button', { name: 'Anna Smith' }).click();
  await expect(window.getByTestId('entity-panel').getByRole('list', { name: 'Shared names' })).toContainText('Shares "Smith" with Ben Smith');
});
