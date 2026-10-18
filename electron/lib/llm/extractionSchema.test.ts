import { describe, it, expect } from 'vitest';
import { ENTITY_KIND_IDS, EXTRACTION_SCHEMA, parseExtraction } from './extractionSchema.js';

const proposal = (over: Record<string, unknown> = {}) => ({
    entity: { id: 'e1', name: 'Mara', kind: 'character', reason: '' },
    attribute: 'eyes',
    value: 'green',
    strength: 'said',
    evidence: [{ quote: 'her eyes are green', turn: 3 }],
    replaces: '',
    ...over,
});

const reply = (proposals: unknown[], extra: Record<string, unknown> = { summary: 'Mara has green eyes.' }) =>
    JSON.stringify({ proposals, ...extra });

async function codeOf(fn: () => unknown) {
    try {
        fn();
    } catch (e) {
        return (e as { code?: string }).code;
    }
    throw new Error('did not throw');
}

describe('EXTRACTION_SCHEMA', () => {
    it('requires every property and allows no extras, so one schema suits every provider', () => {
        const check = (node: Record<string, unknown>) => {
            if (node.type === 'object') {
                expect(node.additionalProperties).toBe(false);
                expect([...(node.required as string[])].sort()).toEqual(Object.keys(node.properties as object).sort());
                for (const child of Object.values(node.properties as Record<string, Record<string, unknown>>)) check(child);
            }
            if (node.type === 'array') check(node.items as Record<string, unknown>);
            expect(Array.isArray(node.type)).toBe(false);
        };
        check(EXTRACTION_SCHEMA as Record<string, unknown>);
    });

    it('lists the known entity kinds', () => {
        expect(ENTITY_KIND_IDS).toEqual(['character', 'location', 'faction', 'item', 'lore', 'event', 'plotline']);
    });
});

describe('parseExtraction', () => {
    it('keeps a valid proposal and the summary', () => {
        expect(parseExtraction(reply([proposal()]))).toEqual({ proposals: [proposal()], summary: 'Mara has green eyes.', dropped: 0 });
    });

    it('drops and counts malformed proposals', () => {
        const bad = [
            proposal({ strength: 'maybe' }),
            proposal({ entity: { id: '', name: 'X', kind: 'dragon', reason: '' } }),
            proposal({ attribute: '  ' }),
            proposal({ value: '' }),
            proposal({ evidence: [] }),
            proposal({ evidence: [{ quote: '', turn: 1 }] }),
            proposal({ evidence: [{ quote: 'x', turn: 1.5 }] }),
            proposal({ evidence: [{ quote: 'x', turn: -1 }] }),
            proposal({ entity: { id: '', name: ' ', kind: 'character', reason: '' } }),
            'not an object',
        ];
        expect(parseExtraction(reply([proposal(), ...bad]))).toMatchObject({ proposals: [proposal()], dropped: bad.length });
    });

    it('trims attribute, value and names', () => {
        const p = parseExtraction(reply([proposal({ attribute: ' eyes ', value: ' green\n', entity: { id: 'e1', name: ' Mara ', kind: 'character', reason: '' } })])).proposals[0];
        expect(p).toMatchObject({ attribute: 'eyes', value: 'green', entity: { name: 'Mara' } });
    });

    it('reads missing optional text as empty', () => {
        const p = { ...proposal(), replaces: undefined, entity: { id: 'e1', name: 'Mara', kind: 'character' } };
        expect(parseExtraction(JSON.stringify({ proposals: [p] }))).toEqual({
            proposals: [proposal()], summary: '', dropped: 0,
        });
    });

    it('tolerates a code fence around the JSON', () => {
        expect(parseExtraction('```json\n' + reply([proposal()]) + '\n```').proposals).toHaveLength(1);
    });

    it('throws PROVIDER for a reply that is not a JSON object with proposals', async () => {
        expect(await codeOf(() => parseExtraction('{"proposals": [{"entity"'))).toBe('PROVIDER');
        expect(await codeOf(() => parseExtraction('[]'))).toBe('PROVIDER');
        expect(await codeOf(() => parseExtraction('{"summary": "x"}'))).toBe('PROVIDER');
    });
});
