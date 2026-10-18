import { describe, it, expect } from 'vitest';
import { resolveTestBaseUrl } from './testOverride.js';

describe('resolveTestBaseUrl', () => {
    it('is silent when the variable is unset', () => {
        expect(resolveTestBaseUrl(undefined, { isPackaged: false })).toEqual({ baseUrl: undefined, warning: null });
        expect(resolveTestBaseUrl('', { isPackaged: true })).toEqual({ baseUrl: undefined, warning: null });
    });

    it('accepts loopback http origins on any port in unpackaged builds', () => {
        for (const url of ['http://127.0.0.1:4100', 'http://localhost:9', 'http://[::1]:8080', 'http://127.0.0.1']) {
            expect(resolveTestBaseUrl(url, { isPackaged: false })).toEqual({ baseUrl: url, warning: null });
        }
        expect(resolveTestBaseUrl('http://127.0.0.1:4100/', { isPackaged: false }).baseUrl).toBe('http://127.0.0.1:4100');
    });

    it('ignores the override in packaged builds', () => {
        const r = resolveTestBaseUrl('http://127.0.0.1:4100', { isPackaged: true });
        expect(r.baseUrl).toBeUndefined();
        expect(r.warning).toMatch(/packaged/);
    });

    it('ignores non-loopback or non-http origins', () => {
        for (const url of [
            'https://evil.example', 'http://evil.example', 'http://127.0.0.1.evil.example', 'https://127.0.0.1:4100',
            'http://user:pw@127.0.0.1:4100', 'http://10.0.0.1', 'file:///etc', 'not a url',
        ]) {
            const r = resolveTestBaseUrl(url, { isPackaged: false });
            expect(r.baseUrl, url).toBeUndefined();
            expect(r.warning, url).toEqual(expect.any(String));
        }
    });
});
