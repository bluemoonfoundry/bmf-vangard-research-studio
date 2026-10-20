import { describe, it, expect } from 'vitest';
import { dialogFilters, MEDIA_KINDS, mediaExtension, mediaKind, mediaMimeType } from './media.js';

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

describe('mediaMimeType', () => {
    it('knows every importable extension', () => {
        for (const { extensions } of Object.values(MEDIA_KINDS)) {
            for (const ext of extensions) expect(mediaMimeType(`a.${ext}`)).not.toBe('application/octet-stream');
        }
        expect(mediaMimeType('A.MP3')).toBe('audio/mpeg');
    });

    it('falls back to a generic type', () => {
        expect(mediaMimeType('a.svg')).toBe('application/octet-stream');
        expect(mediaMimeType('toString')).toBe('application/octet-stream');
    });
});
