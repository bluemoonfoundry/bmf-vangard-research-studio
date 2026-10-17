import { validateExternalUrl } from './ipcSecurity.js';

/** webPreferences for every app window: isolated, sandboxed, no Node in the renderer. */
export function secureWebPreferences(preloadPath) {
    return {
        preload: preloadPath,
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        webviewTag: false,
    };
}

/**
 * True only for navigations that stay on the app's own page (reloads and hash
 * changes). Everything else -- remote sites, other local files -- is blocked so
 * a malicious link or injected script can't swap the app out from under the
 * preload bridge.
 */
export function isAllowedNavigation(targetUrl, appUrl) {
    try {
        const target = new URL(targetUrl);
        const app = new URL(appUrl);
        return target.protocol === app.protocol
            && target.host === app.host
            && target.pathname === app.pathname;
    } catch {
        return false;
    }
}

/**
 * setWindowOpenHandler callback: never opens a new Electron window. Safe
 * http(s) links are handed to the system browser instead.
 */
export function handleWindowOpen(url, openExternal) {
    if (validateExternalUrl(url) === null) {
        openExternal(url);
    }
    return { action: 'deny' };
}

/** Wires navigation and window-open guards onto a BrowserWindow's webContents. */
export function applyNavigationGuards(webContents, appUrl, openExternal) {
    webContents.on('will-navigate', (event, url) => {
        if (!isAllowedNavigation(url, appUrl)) event.preventDefault();
    });
    webContents.setWindowOpenHandler(({ url }) => handleWindowOpen(url, openExternal));
}
