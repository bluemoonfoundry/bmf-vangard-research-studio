import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { createAppSettings } from './appSettings.js';
import { createThemeSetting } from './themeSetting.js';

let tmp: string;
let file: string;

beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'vrs-theme-'));
    file = path.join(tmp, 'settings.json');
});

afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true });
});

function setup() {
    const nativeTheme = { themeSource: 'system' };
    const warn = vi.fn();
    const theme = createThemeSetting({ settings: createAppSettings(file), nativeTheme, warn });
    return { nativeTheme, warn, theme };
}

describe('themeSetting', () => {
    it('apply() follows the stored theme', async () => {
        await fs.writeFile(file, JSON.stringify({ theme: 'dark' }), 'utf-8');
        const { nativeTheme, theme } = setup();
        await theme.apply();
        expect(nativeTheme.themeSource).toBe('dark');
    });

    it('apply() falls back to system when settings cannot be read', async () => {
        await fs.mkdir(file);
        const { nativeTheme, warn, theme } = setup();
        nativeTheme.themeSource = 'light';
        await theme.apply();
        expect(nativeTheme.themeSource).toBe('system');
        expect(warn).toHaveBeenCalled();
    });

    it('get() returns the stored theme, system by default', async () => {
        const { theme } = setup();
        expect(await theme.get()).toBe('system');
    });

    it('set() persists the theme, keeps other settings and applies it', async () => {
        await fs.writeFile(file, JSON.stringify({ ai: { enabled: true }, extra: 1 }), 'utf-8');
        const { nativeTheme, theme } = setup();
        expect(await theme.set('light')).toBe('light');
        expect(nativeTheme.themeSource).toBe('light');
        const stored = await createAppSettings(file).read();
        expect(stored.theme).toBe('light');
        expect(stored.ai.enabled).toBe(true);
        expect(stored.extra).toBe(1);
    });

    it('set() refuses anything but a known theme', async () => {
        const { nativeTheme, theme } = setup();
        await expect(theme.set('sepia')).rejects.toMatchObject({ code: 'INVALID' });
        await expect(theme.set(undefined)).rejects.toMatchObject({ code: 'INVALID' });
        expect(nativeTheme.themeSource).toBe('system');
        await expect(fs.access(file)).rejects.toBeTruthy();
    });
});
