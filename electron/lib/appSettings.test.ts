import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { createAppSettings, PROVIDER_IDS } from './appSettings.js';

let tmp: string;
let file: string;

const DEFAULTS = {
    ai: {
        enabled: false,
        defaultProvider: null,
        defaultModel: null,
        providers: { gemini: { lastTestOk: null }, anthropic: { lastTestOk: null }, openai: { lastTestOk: null } },
    },
};

beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'vrs-settings-'));
    file = path.join(tmp, 'app-settings.json');
});

afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true });
});

describe('appSettings', () => {
    it('lists the provider ids', () => {
        expect(PROVIDER_IDS).toEqual(['gemini', 'anthropic', 'openai']);
    });

    it('defaults when the file is missing', async () => {
        expect(await createAppSettings(file).read()).toEqual(DEFAULTS);
    });

    it('defaults when the file is corrupt JSON', async () => {
        await fs.writeFile(file, '{ nope', 'utf-8');
        expect(await createAppSettings(file).read()).toEqual(DEFAULTS);
    });

    it('update persists and keeps unknown fields', async () => {
        await fs.writeFile(file, JSON.stringify({ theme: 'dark', ai: { extra: 1 } }), 'utf-8');
        const settings = createAppSettings(file);
        const updated = await settings.update(s => ({ ...s, ai: { ...s.ai, enabled: true } }));
        expect(updated.ai.enabled).toBe(true);
        const reread = await createAppSettings(file).read();
        expect(reread.theme).toBe('dark');
        expect(reread.ai.extra).toBe(1);
        expect(reread.ai.enabled).toBe(true);
        expect(reread.ai.providers.gemini).toEqual({ lastTestOk: null });
    });
});
