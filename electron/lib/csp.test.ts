import { describe, it, expect } from 'vitest';
import { buildContentSecurityPolicy } from './csp.js';

function directives(csp: string): Map<string, string[]> {
    const map = new Map<string, string[]>();
    for (const part of csp.split(';')) {
        const [name, ...sources] = part.trim().split(/\s+/);
        if (name) map.set(name, sources);
    }
    return map;
}

describe('buildContentSecurityPolicy', () => {
    const csp = directives(buildContentSecurityPolicy());

    it('restricts everything to self by default', () => {
        expect(csp.get('default-src')).toEqual(["'self'"]);
    });

    it('never allows the renderer to reach the network directly', () => {
        // All network access (e.g. LLM providers) must go through the main process.
        expect(csp.get('connect-src')).toEqual(["'self'"]);
    });

    it('only allows scripts bundled with the app', () => {
        expect(csp.get('script-src')).toEqual(["'self'"]);
    });

    it('does not load remote images, fonts, or media', () => {
        for (const name of ['img-src', 'font-src', 'media-src']) {
            const sources = csp.get(name) ?? [];
            expect(sources.some(s => s.startsWith('http'))).toBe(false);
        }
    });

    it('allows project assets only as images and media', () => {
        expect(csp.get('img-src')).toContain('vrs-asset:');
        expect(csp.get('media-src')).toContain('vrs-asset:');
        for (const [name, sources] of csp) {
            if (name !== 'img-src' && name !== 'media-src') expect(sources).not.toContain('vrs-asset:');
        }
    });

    it('locks down plugins, framing, base URI, and form posts', () => {
        expect(csp.get('object-src')).toEqual(["'none'"]);
        expect(csp.get('frame-src')).toEqual(["'none'"]);
        expect(csp.get('base-uri')).toEqual(["'none'"]);
        expect(csp.get('form-action')).toEqual(["'none'"]);
    });
});
