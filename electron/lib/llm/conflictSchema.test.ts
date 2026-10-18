import { describe, it, expect } from 'vitest';
import { CONFLICT_SCHEMA, parseConflicts } from './conflictSchema.js';

const flag = (over: Record<string, unknown> = {}) => ({ a: 'F1', b: 'F2', reason: 'Born 40 years before the story makes her about 40, not 24.', ...over });

describe('CONFLICT_SCHEMA', () => {
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
        check(CONFLICT_SCHEMA as Record<string, unknown>);
    });
});

describe('parseConflicts', () => {
    it('returns well-formed flags with trimmed text', () => {
        const result = parseConflicts(JSON.stringify({ conflicts: [flag({ a: ' F1 ', reason: '  Ages disagree. ' })] }));
        expect(result).toEqual({ conflicts: [{ a: 'F1', b: 'F2', reason: 'Ages disagree.' }], dropped: 0 });
    });

    it('drops and counts malformed flags, including a fact paired with itself', () => {
        const result = parseConflicts(JSON.stringify({
            conflicts: [flag(), flag({ a: '' }), flag({ b: 'F1', a: 'F1' }), flag({ reason: 3 }), 'nope'],
        }));
        expect(result.conflicts).toHaveLength(1);
        expect(result.dropped).toBe(4);
    });

    it('accepts a fenced reply', () => {
        expect(parseConflicts('```json\n{"conflicts":[]}\n```')).toEqual({ conflicts: [], dropped: 0 });
    });

    it('throws PROVIDER for a reply that is not a conflicts object', () => {
        for (const reply of ['Sure!', '[]', '{"flags":[]}']) {
            let code: string | undefined;
            try {
                parseConflicts(reply);
            } catch (e) {
                code = (e as { code?: string }).code;
            }
            expect(code).toBe('PROVIDER');
        }
    });
});
