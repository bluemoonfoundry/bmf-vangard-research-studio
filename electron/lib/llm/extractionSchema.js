import { LlmError } from './http.js';

/**
 * The JSON an extraction reply must match (llm:extract). One schema serves every provider's
 * structured-output mode, so it keeps to what all three accept: every property is required, objects
 * allow no extra properties, and there are no nulls or type arrays. "None" is '' (entity id,
 * replaces) or 0 (turn). Only the main process holds it; the renderer never sends a schema.
 */

/** Mirrors ENTITY_KINDS in src/bible/entities.ts. */
export const ENTITY_KIND_IDS = ['character', 'location', 'faction', 'item', 'lore', 'event', 'plotline'];
export const STRENGTHS = ['said', 'built_on', 'suggested'];

const text = (description) => ({ type: 'string', description });

export const EXTRACTION_SCHEMA = {
    type: 'object',
    additionalProperties: false,
    required: ['proposals', 'summary'],
    properties: {
        proposals: {
            type: 'array',
            items: {
                type: 'object',
                additionalProperties: false,
                required: ['entity', 'attribute', 'value', 'strength', 'evidence', 'replaces'],
                properties: {
                    entity: {
                        type: 'object',
                        additionalProperties: false,
                        required: ['id', 'name', 'kind', 'reason'],
                        properties: {
                            id: text("An existing entity's id from the canon, or '' for a new card."),
                            name: text("The entity's name."),
                            kind: { type: 'string', enum: ENTITY_KIND_IDS },
                            reason: text("For a new card, why it deserves one; otherwise ''."),
                        },
                    },
                    attribute: text('The attribute name, reusing an existing one when it means the same.'),
                    value: text('The condensed value, reusing existing wording when it means the same.'),
                    strength: { type: 'string', enum: STRENGTHS },
                    evidence: {
                        type: 'array',
                        items: {
                            type: 'object',
                            additionalProperties: false,
                            required: ['quote', 'turn'],
                            properties: {
                                quote: text('A passage copied exactly from one turn of the source.'),
                                turn: { type: 'integer', description: 'The number of the turn the quote is from.' },
                            },
                        },
                    },
                    replaces: text("The earlier value this replaces within the same source, or ''."),
                },
            },
        },
        summary: text('Entities and adopted facts established so far, for reading the next part.'),
    },
};

const isObject = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v) => (typeof v === 'string' ? v.trim() : '');

const notJson = () => new LlmError('PROVIDER', "The AI's reply wasn't valid JSON. Try again, or try a smaller source.");

/** A well-formed proposal with trimmed text, or null. */
function checkProposal(raw) {
    if (!isObject(raw) || !isObject(raw.entity)) return null;
    const entity = { id: str(raw.entity.id), name: str(raw.entity.name), kind: str(raw.entity.kind), reason: str(raw.entity.reason) };
    if (!entity.name && !entity.id) return null;
    if (!ENTITY_KIND_IDS.includes(entity.kind)) return null;
    const attribute = str(raw.attribute);
    const value = str(raw.value);
    if (!attribute || !value || !STRENGTHS.includes(raw.strength)) return null;
    if (!Array.isArray(raw.evidence) || raw.evidence.length === 0) return null;
    const evidence = [];
    for (const e of raw.evidence) {
        if (!isObject(e) || typeof e.quote !== 'string' || !e.quote.trim() || !Number.isInteger(e.turn) || e.turn < 0) return null;
        evidence.push({ quote: e.quote, turn: e.turn });
    }
    return { entity, attribute, value, strength: raw.strength, evidence, replaces: str(raw.replaces) };
}

/**
 * Parses and validates a reply. Malformed proposals are dropped and counted; a reply that isn't a
 * JSON object with a proposals list throws PROVIDER.
 * @param {string} reply
 * @returns {{ proposals: any[], summary: string, dropped: number }}
 */
export function parseExtraction(reply) {
    const body = reply.trim().replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```$/, '');
    let parsed;
    try {
        parsed = JSON.parse(body);
    } catch {
        throw notJson();
    }
    if (!isObject(parsed) || !Array.isArray(parsed.proposals)) throw notJson();
    const proposals = [];
    let dropped = 0;
    for (const raw of parsed.proposals) {
        const p = checkProposal(raw);
        if (p) proposals.push(p);
        else dropped += 1;
    }
    return { proposals, summary: str(parsed.summary), dropped };
}
