import { useCallback, useEffect, useRef, useState } from 'react';
import { unwrap } from '@/project/api';

/** 'system' follows the OS. The main process applies the choice, so CSS only ever reads `prefers-color-scheme`. */
export type Theme = 'system' | 'light' | 'dark';

export const THEME_OPTIONS: { id: Theme; name: string }[] = [
  { id: 'system', name: 'System' },
  { id: 'light', name: 'Light' },
  { id: 'dark', name: 'Dark' },
];

export interface ThemeController {
  /** False when there is no desktop bridge (the page then follows the browser's theme). */
  available: boolean;
  /** Null until loaded. */
  theme: Theme | null;
  setTheme(theme: Theme): Promise<void>;
  error: string | null;
}

const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** The stored theme preference (userData/settings.json, via the main process). */
export function useTheme(app: Pick<VrsApi['app'], 'getTheme' | 'setTheme'> | null): ThemeController {
  const [theme, setThemeState] = useState<Theme | null>(null);
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    if (app) {
      unwrap(app.getTheme()).then(
        (t) => { if (alive.current) setThemeState(t); },
        (e) => { if (alive.current) setError(messageOf(e)); },
      );
    }
    return () => {
      alive.current = false;
    };
  }, [app]);

  const setTheme = useCallback(async (next: Theme) => {
    if (!app) return;
    try {
      const stored = await unwrap(app.setTheme(next));
      if (!alive.current) return;
      setThemeState(stored);
      setError(null);
    } catch (e) {
      if (alive.current) setError(messageOf(e));
    }
  }, [app]);

  return { available: app !== null, theme, setTheme, error };
}
