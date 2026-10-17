import { describe, it, expect } from 'vitest';
import { dialogFilters, mediaExtension, mediaKind } from './media.js';

describe('media kinds', () => {
    it('normalises allowed extensions to lower case', () => {
        expect(mediaExtension('/music/Sea Shanty.MP3', 'audio')).toBe('mp3');
        expect(mediaExtension('/pics/a.jpeg', 'image')).toBe('jpeg');
    });

    it.each([
        ['/pics/vector.svg', 'image'],
        ['/pics/noext', 'image'],
        ['/pics/a.png', 'audio'],
    ])('refuses %s as %s', (file, kind) => {
        expect(() => mediaExtension(file, kind)).toThrow(expect.objectContaining({ code: 'UNSUPPORTED' }));
    });

    it('rejects unknown kinds, including inherited property names', () => {
        expect(() => mediaKind('toString')).toThrow(expect.objectContaining({ code: 'INVALID' }));
    });

    it('builds native dialog filters', () => {
        expect(dialogFilters('image')).toEqual([{ name: 'Images', extensions: expect.arrayContaining(['png', 'webp']) }]);
    });
});
