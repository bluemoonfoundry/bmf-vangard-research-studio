import { LlmError } from './http.js';

/**
 * The JSON a semantic conflict check reply must match (llm:conflict-check). Same rules as
 * EXTRACTION_SCHEMA so it suits every provider: every property required, no extras, no nulls.
 * Facts are named by the short refs ("F1") the renderer put in the request; the renderer maps them back.
 */

const text = (description) => ({ type: 'string', description });

export const CONFLICT_SCHEMA = {
    type: 'object',
    additionalProperties: false,
    required: ['conflicts'],
    properties: {
        conflicts: {
            type: 'array',
            items: {
                type: 'object',
                additionalProperties: false,
                required: ['a', 'b', 'reason'],
                properties: {
                    a: text('The ref of one fact, e.g. "F3".'),
                    b: text('The ref of the other fact.'),
                    reason: text('One short sentence: why the two cannot both be true.'),
                },
            },
        },
    },
};

const isObject = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v) => (typeof v === 'string' ? v.trim() : '');

const notJson = () => new LlmError('PROVIDER', "The AI's reply wasn't valid JSON. Try again, or check fewer facts.");

/**
 * Parses and validates a reply. Malformed flags (missing text, a fact paired with itself) are dropped
 * and counted; a reply that isn't a JSON object with a conflicts list throws PROVIDER.
 * @param {string} reply
 * @returns {{ conflicts: { a: string, b: string, reason: string }[], dropped: number }}
 */
export function parseConflicts(reply) {
    const body = reply.trim().replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```$/, '');
    let parsed;
    try {
        parsed = JSON.parse(body);
    } catch {
        throw notJson();
    }
    if (!isObject(parsed) || !Array.isArray(parsed.conflicts)) throw notJson();
    const conflicts = [];
    let dropped = 0;
    for (const raw of parsed.conflicts) {
        const flag = isObject(raw) && typeof raw.reason === 'string'
            ? { a: str(raw.a), b: str(raw.b), reason: str(raw.reason) }
            : null;
        if (flag && flag.a && flag.b && flag.a !== flag.b && flag.reason) conflicts.push(flag);
        else dropped += 1;
    }
    return { conflicts, dropped };
}
