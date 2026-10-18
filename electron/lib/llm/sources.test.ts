import { describe, it, expect } from 'vitest';
import { normalizeSources } from './sources.js';

describe('normalizeSources', () => {
    it('keeps only http(s) urls, preserving order', () => {
        expect(
            normalizeSources([
                { url: 'https://a.example/1', title: 'A' },
                { url: 'javascript:alert(1)', title: 'Bad' },
                { url: 'ftp://x.example/f' },
                { title: 'No url' },
                { url: 'HTTP://b.example/2' },
            ]),
        ).toEqual([{ title: 'A', url: 'https://a.example/1' }, { url: 'HTTP://b.example/2' }]);
    });

    it('dedupes by url keeping the first title', () => {
        expect(
            normalizeSources([
                { url: 'https://a.example/1' },
                { url: 'https://a.example/1', title: 'Later' },
                { url: 'https://c.example/3', title: 'C' },
                { url: 'https://c.example/3', title: 'C2' },
            ]),
        ).toEqual([{ url: 'https://a.example/1' }, { title: 'C', url: 'https://c.example/3' }]);
    });

    it('returns an empty array for empty input', () => {
        expect(normalizeSources([])).toEqual([]);
    });
});
