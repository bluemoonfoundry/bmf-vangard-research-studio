import crypto from 'crypto';

/**
 * @typedef {{ id: string, name: string, systemPrompt: string } & Record<string, unknown>} PersonaPreset
 */

export const MAX_PRESETS = 50;
export const MAX_NAME_LENGTH = 60;
export const MAX_PROMPT_LENGTH = 20_000;

const invalid = (message) => Object.assign(new Error(message), { code: 'INVALID' });

function isObject(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Keeps well-formed presets (first of each id), with their unknown fields. */
function presetsOf(settings) {
    const raw = Array.isArray(settings.ai.personas) ? settings.ai.personas : [];
    const seen = new Set();
    const out = [];
    for (const p of raw) {
        if (!isObject(p) || typeof p.id !== 'string' || !p.id || seen.has(p.id)) continue;
        if (typeof p.name !== 'string' || !p.name.trim() || typeof p.systemPrompt !== 'string') continue;
        seen.add(p.id);
        out.push(p);
    }
    return out;
}

/** @param {unknown} input */
function validate(input) {
    if (!isObject(input)) throw invalid('A preset needs a name and a prompt.');
    const { id, name, systemPrompt } = input;
    if (id !== undefined && typeof id !== 'string') throw invalid('Unknown preset id.');
    if (typeof name !== 'string' || !name.trim()) throw invalid('Give the preset a name.');
    if (name.trim().length > MAX_NAME_LENGTH) throw invalid(`Preset names are at most ${MAX_NAME_LENGTH} characters.`);
    if (typeof systemPrompt !== 'string' || !systemPrompt.trim()) throw invalid('A preset needs a prompt.');
    if (systemPrompt.length > MAX_PROMPT_LENGTH) throw invalid(`Preset prompts are at most ${MAX_PROMPT_LENGTH} characters.`);
    return { id, name: name.trim(), systemPrompt };
}

/**
 * Writers' own AI Chat personas, app-wide, kept in settings.json under `ai.personas`.
 * An AI feature: every call is refused while AI is disabled.
 * @param {{ settings: ReturnType<typeof import('./appSettings.js').createAppSettings>, newId?: () => string }} deps
 */
export function createPersonaPresets({ settings, newId = () => `preset-${crypto.randomUUID()}` }) {
    async function requireEnabled() {
        const s = await settings.read();
        if (!s.ai.enabled) {
            throw Object.assign(new Error('AI is turned off. Enable it in Settings → AI.'), { code: 'AI_DISABLED' });
        }
        return s;
    }

    return {
        async list() {
            return presetsOf(await requireEnabled());
        },

        /**
         * Creates a preset, or replaces the name and prompt of the one with `id`.
         * @param {unknown} input
         * @returns {Promise<{ preset: PersonaPreset, presets: PersonaPreset[] }>}
         */
        async save(input) {
            const { id, name, systemPrompt } = validate(input);
            await requireEnabled();
            let preset;
            const next = await settings.update(s => {
                const list = presetsOf(s);
                const existing = id === undefined ? undefined : list.find(p => p.id === id);
                if (id !== undefined && !existing) throw Object.assign(new Error('That preset no longer exists.'), { code: 'NOT_FOUND' });
                if (list.some(p => p.id !== id && p.name.trim().toLowerCase() === name.toLowerCase())) {
                    throw invalid(`A preset named "${name}" already exists.`);
                }
                if (!existing && list.length >= MAX_PRESETS) {
                    throw Object.assign(new Error(`You can keep up to ${MAX_PRESETS} presets.`), { code: 'LIMIT' });
                }
                preset = existing ? { ...existing, name, systemPrompt } : { id: newId(), name, systemPrompt };
                const personas = existing ? list.map(p => (p.id === id ? preset : p)) : [...list, preset];
                return { ...s, ai: { ...s.ai, personas } };
            });
            return { preset, presets: presetsOf(next) };
        },

        /** @param {unknown} id */
        async delete(id) {
            await requireEnabled();
            const next = await settings.update(s => ({ ...s, ai: { ...s.ai, personas: presetsOf(s).filter(p => p.id !== id) } }));
            return presetsOf(next);
        },
    };
}
