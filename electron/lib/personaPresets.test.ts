import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { createAppSettings } from './appSettings.js';
import { createPersonaPresets, MAX_PRESETS, MAX_NAME_LENGTH, MAX_PROMPT_LENGTH } from './personaPresets.js';

let tmp: string;
let file: string;

beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'vrs-personas-'));
    file = path.join(tmp, 'settings.json');
});

afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true });
});

async function setup(stored: Record<string, unknown> = {}, enabled = true) {
    await fs.writeFile(file, JSON.stringify({ ...stored, ai: { enabled, ...(stored.ai as object) } }), 'utf-8');
    const settings = createAppSettings(file);
    return { settings, presets: createPersonaPresets({ settings }) };
}

describe('personaPresets', () => {
    it('lists nothing by default', async () => {
        const { presets } = await setup();
        expect(await presets.list()).toEqual([]);
    });

    it('saves a new preset with a generated id, trimmed name, and keeps other settings', async () => {
        const { presets, settings } = await setup({ theme: 'dark', extra: 1 });
        const { preset, presets: list } = await presets.save({ name: '  Noir Editor ', systemPrompt: 'Be hard-boiled.' });
        expect(preset).toMatchObject({ name: 'Noir Editor', systemPrompt: 'Be hard-boiled.' });
        expect(preset.id).toMatch(/^preset-[0-9a-f-]{36}$/);
        expect(list).toEqual([preset]);
        expect(await presets.list()).toEqual([preset]);
        const stored = await settings.read();
        expect(stored.theme).toBe('dark');
        expect(stored.extra).toBe(1);
        expect(stored.ai.enabled).toBe(true);
    });

    it('updates an existing preset by id, in place', async () => {
        const { presets } = await setup();
        const a = (await presets.save({ name: 'A', systemPrompt: 'one' })).preset;
        const b = (await presets.save({ name: 'B', systemPrompt: 'two' })).preset;
        const { preset, presets: list } = await presets.save({ id: a.id, name: 'A2', systemPrompt: 'uno' });
        expect(preset).toEqual({ id: a.id, name: 'A2', systemPrompt: 'uno' });
        expect(list.map(p => p.id)).toEqual([a.id, b.id]);
    });

    it('refuses an update to an unknown id', async () => {
        const { presets } = await setup();
        await expect(presets.save({ id: 'preset-nope', name: 'A', systemPrompt: 'x' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });

    it('refuses a name another preset already uses, ignoring case', async () => {
        const { presets } = await setup();
        const a = (await presets.save({ name: 'Noir', systemPrompt: 'x' })).preset;
        await expect(presets.save({ name: 'noir ', systemPrompt: 'y' })).rejects.toMatchObject({ code: 'INVALID' });
        // Saving a preset under its own name is fine.
        await expect(presets.save({ id: a.id, name: 'NOIR', systemPrompt: 'y' })).resolves.toBeTruthy();
    });

    it('refuses bad input', async () => {
        const { presets } = await setup();
        const bad = [
            undefined, null, 'x', {},
            { name: '', systemPrompt: 'x' },
            { name: '   ', systemPrompt: 'x' },
            { name: 'A', systemPrompt: '  ' },
            { name: 'A', systemPrompt: 5 },
            { name: 'x'.repeat(MAX_NAME_LENGTH + 1), systemPrompt: 'x' },
            { name: 'A', systemPrompt: 'x'.repeat(MAX_PROMPT_LENGTH + 1) },
            { id: 5, name: 'A', systemPrompt: 'x' },
        ];
        for (const input of bad) await expect(presets.save(input)).rejects.toMatchObject({ code: 'INVALID' });
        await expect(fs.readFile(file, 'utf-8')).resolves.not.toContain('personas');
    });

    it(`refuses more than ${MAX_PRESETS} presets`, async () => {
        const many = Array.from({ length: MAX_PRESETS }, (_, i) => ({ id: `preset-${i}`, name: `P${i}`, systemPrompt: 'x' }));
        const { presets } = await setup({ ai: { personas: many } });
        await expect(presets.save({ name: 'One more', systemPrompt: 'x' })).rejects.toMatchObject({ code: 'LIMIT' });
        // Editing one still works at the limit.
        await expect(presets.save({ id: 'preset-0', name: 'P0', systemPrompt: 'y' })).resolves.toBeTruthy();
    });

    it('deletes by id; an unknown id is a no-op', async () => {
        const { presets } = await setup();
        const a = (await presets.save({ name: 'A', systemPrompt: 'x' })).preset;
        const b = (await presets.save({ name: 'B', systemPrompt: 'y' })).preset;
        expect(await presets.delete(a.id)).toEqual([b]);
        expect(await presets.delete('preset-gone')).toEqual([b]);
        expect(await presets.list()).toEqual([b]);
    });

    it('drops malformed and repeated stored entries on read, keeping unknown fields', async () => {
        const { presets } = await setup({
            ai: {
                personas: [
                    { id: 'preset-1', name: 'Good', systemPrompt: 'x', color: 'red' },
                    { id: 'preset-1', name: 'Repeat', systemPrompt: 'y' },
                    { id: 'preset-2', name: '', systemPrompt: 'y' },
                    { name: 'No id', systemPrompt: 'y' },
                    'junk',
                ],
            },
        });
        expect(await presets.list()).toEqual([{ id: 'preset-1', name: 'Good', systemPrompt: 'x', color: 'red' }]);
    });

    it('reads a non-array personas field as empty', async () => {
        const { presets } = await setup({ ai: { personas: 'nope' } });
        expect(await presets.list()).toEqual([]);
    });

    it('refuses every call while AI is disabled', async () => {
        const { presets } = await setup({}, false);
        await expect(presets.list()).rejects.toMatchObject({ code: 'AI_DISABLED' });
        await expect(presets.save({ name: 'A', systemPrompt: 'x' })).rejects.toMatchObject({ code: 'AI_DISABLED' });
        await expect(presets.delete('preset-1')).rejects.toMatchObject({ code: 'AI_DISABLED' });
    });
});
