import { describe, it, expect, vi } from 'vitest';
import { secureWebPreferences, isAllowedNavigation, handleWindowOpen } from './windowSecurity.js';

const APP_URL = 'file:///C:/apps/vrs/dist/index.html';

describe('secureWebPreferences', () => {
    const prefs = secureWebPreferences('/app/electron/preload.js');

    it('isolates and sandboxes the renderer', () => {
        expect(prefs.contextIsolation).toBe(true);
        expect(prefs.sandbox).toBe(true);
        expect(prefs.nodeIntegration).toBe(false);
        expect(prefs.webviewTag).toBe(false);
    });

    it('uses the given preload script', () => {
        expect(prefs.preload).toBe('/app/electron/preload.js');
    });
});

describe('isAllowedNavigation', () => {
    it('allows reloading the app page itself', () => {
        expect(isAllowedNavigation(APP_URL, APP_URL)).toBe(true);
    });

    it('allows hash changes on the app page', () => {
        expect(isAllowedNavigation(`${APP_URL}#/settings`, APP_URL)).toBe(true);
    });

    it('blocks remote sites', () => {
        expect(isAllowedNavigation('https://example.com/', APP_URL)).toBe(false);
    });

    it('blocks other local files', () => {
        expect(isAllowedNavigation('file:///C:/Windows/system.ini', APP_URL)).toBe(false);
    });

    it('blocks malformed URLs', () => {
        expect(isAllowedNavigation('not a url', APP_URL)).toBe(false);
    });
});

describe('handleWindowOpen', () => {
    it('never lets the renderer open a new Electron window', () => {
        const openExternal = vi.fn();
        expect(handleWindowOpen('https://example.com/', openExternal)).toEqual({ action: 'deny' });
    });

    it('sends http(s) links to the system browser', () => {
        const openExternal = vi.fn();
        handleWindowOpen('https://example.com/page', openExternal);
        expect(openExternal).toHaveBeenCalledWith('https://example.com/page');
    });

    it('does not open dangerous protocols externally', () => {
        const openExternal = vi.fn();
        for (const url of ['file:///C:/x.exe', 'javascript:alert(1)', 'smb://host/share']) {
            handleWindowOpen(url, openExternal);
        }
        expect(openExternal).not.toHaveBeenCalled();
    });
});
