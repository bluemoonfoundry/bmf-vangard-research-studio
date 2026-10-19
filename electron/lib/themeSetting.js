import { THEMES } from './appSettings.js';

/**
 * The app's light/dark preference. Applying it sets Electron's
 * `nativeTheme.themeSource`, so the renderer's `prefers-color-scheme` (and the
 * native window chrome) follow it without the renderer doing anything.
 * @param {{ settings: ReturnType<typeof import('./appSettings.js').createAppSettings>,
 *   nativeTheme: { themeSource: string }, warn: (message: string, err?: unknown) => void }} deps
 */
export function createThemeSetting({ settings, nativeTheme, warn }) {
    return {
        /** Applies the stored theme; an unreadable settings file leaves the OS theme in charge. */
        async apply() {
            try {
                nativeTheme.themeSource = (await settings.read()).theme;
            } catch (err) {
                warn('Reading the theme setting failed', err);
                nativeTheme.themeSource = 'system';
            }
        },

        async get() {
            return (await settings.read()).theme;
        },

        /** @param {unknown} theme */
        async set(theme) {
            if (!THEMES.includes(theme)) throw Object.assign(new Error('Unknown theme.'), { code: 'INVALID' });
            const next = await settings.update(s => ({ ...s, theme }));
            nativeTheme.themeSource = next.theme;
            return next.theme;
        },
    };
}
