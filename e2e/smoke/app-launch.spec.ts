import { test, expect } from '../electron-launch';

test('launches and shows the app shell with its version', async ({ window }) => {
  await expect(window.getByRole('heading', { name: 'Vangard Research Studio' })).toBeVisible();
  await expect(window.getByText(/^v\d+\.\d+\.\d+$/)).toBeVisible();
});

test('renderer has no Node.js access', async ({ window }) => {
  const nodeVisible = await window.evaluate(() => {
    const w = window as unknown as Record<string, unknown>;
    return typeof w.require !== 'undefined' || typeof w.process !== 'undefined';
  });
  expect(nodeVisible).toBe(false);
});

test('Content-Security-Policy blocks direct network requests from the renderer', async ({ window }) => {
  // Require the CSP violation itself, so the test can't pass just because the machine is offline.
  const cspViolation = window.waitForEvent('console', {
    predicate: (msg) => msg.type() === 'error' && /Content Security Policy/i.test(msg.text()),
  });
  const outcome = await window.evaluate(async () => {
    try {
      await fetch('https://example.com/');
      return 'allowed';
    } catch {
      return 'blocked';
    }
  });
  expect(outcome).toBe('blocked');
  expect((await cspViolation).text()).toMatch(/connect-src/);
});

test('the preload bridge exposes only the intended API', async ({ window }) => {
  // Window security flags themselves are unit-tested in electron/lib/windowSecurity.test.ts.
  const surface = await window.evaluate(() => {
    const vrs = (window as unknown as { vrs: Record<string, Record<string, unknown>> }).vrs;
    return Object.fromEntries(Object.entries(vrs).map(([ns, fns]) => [ns, Object.keys(fns).sort()]));
  });
  expect(surface).toEqual({
    app: ['closeConfirmed', 'getVersion', 'onSaveBeforeClose', 'openExternal'],
    project: [
      'close', 'confirmUnsaved', 'create', 'discardRecovery', 'exportDossier', 'importMedia', 'listRecent',
      'onExternalChange', 'open', 'openRecent', 'readAsset', 'readDoc', 'readStructure', 'removeRecent', 'save',
      'setDirty', 'writeRecovery',
    ],
  });
});
