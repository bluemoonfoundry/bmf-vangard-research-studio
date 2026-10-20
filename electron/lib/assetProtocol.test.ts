import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { ProjectFormatError } from './projectSchema.js';
import { assetNameFromUrl, assetUrl, createAssetProtocolHandler, parseRange } from './assetProtocol.js';

describe('parseRange', () => {
    it.each([
        ['bytes=0-', { start: 0, end: 9 }],
        ['bytes=2-5', { start: 2, end: 5 }],
        ['bytes=4-100', { start: 4, end: 9 }],
        ['bytes=-3', { start: 7, end: 9 }],
        ['bytes=-50', { start: 0, end: 9 }],
        [' bytes = 1 - 2 ', { start: 1, end: 2 }],
    ])('reads %s of a 10-byte file', (header, range) => {
        expect(parseRange(header, 10)).toEqual(range);
    });

    it.each([
        [undefined], [null], [''], ['bytes=5-2'], ['items=0-1'], ['bytes=0-1,4-5'], ['bytes=-0'], ['bytes=a-b'], ['bytes=-'],
    ])('ignores %s, so the whole file is sent', (header) => {
        expect(parseRange(header, 10)).toBeNull();
    });

    it('refuses a range that starts past the end', () => {
        expect(parseRange('bytes=10-', 10)).toBe('unsatisfiable');
        expect(parseRange('bytes=0-', 0)).toBe('unsatisfiable');
    });
});

describe('asset URLs', () => {
    it('round-trips an asset name, ignoring the version query', () => {
        const url = assetUrl('abc.mp3', 3);
        expect(url).toBe('vrs-asset://project/abc.mp3?v=3');
        expect(assetNameFromUrl(url)).toBe('abc.mp3');
    });

    it.each([
        'vrs-asset://other/abc.mp3',
        'file:///project/abc.mp3',
        'vrs-asset://project/a/b.mp3',
        'vrs-asset://project/%2e%2e%2fvrs.json',
        'vrs-asset://project/',
        'not a url',
    ])('finds no asset in %s', (url) => {
        expect(assetNameFromUrl(url)).toBeNull();
    });
});

describe('createAssetProtocolHandler', () => {
    let tmp: string;
    let file: string;
    const bytes = Buffer.from('0123456789');

    beforeEach(async () => {
        tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'vrs-asset-protocol-'));
        file = path.join(tmp, 'tape.mp3');
        await fs.writeFile(file, bytes);
    });

    afterEach(async () => {
        await fs.rm(tmp, { recursive: true, force: true });
    });

    const handlerFor = (resolveAsset: (name: string) => Promise<string>) => createAssetProtocolHandler({ resolveAsset });
    const serve = (url: string, init?: RequestInit) => handlerFor(async () => file)(new Request(url, init));

    it('sends the whole file with its type when no range is asked for', async () => {
        const res = await serve('vrs-asset://project/tape.mp3');
        expect(res.status).toBe(200);
        expect(res.headers.get('content-type')).toBe('audio/mpeg');
        expect(res.headers.get('content-length')).toBe('10');
        expect(res.headers.get('accept-ranges')).toBe('bytes');
        expect(res.headers.get('x-content-type-options')).toBe('nosniff');
        expect(Buffer.from(await res.arrayBuffer())).toEqual(bytes);
    });

    it('streams just the requested range', async () => {
        const res = await serve('vrs-asset://project/tape.mp3', { headers: { Range: 'bytes=3-5' } });
        expect(res.status).toBe(206);
        expect(res.headers.get('content-range')).toBe('bytes 3-5/10');
        expect(res.headers.get('content-length')).toBe('3');
        expect(await res.text()).toBe('345');
    });

    it('answers an unsatisfiable range with 416 and the real size', async () => {
        const res = await serve('vrs-asset://project/tape.mp3', { headers: { Range: 'bytes=20-' } });
        expect(res.status).toBe(416);
        expect(res.headers.get('content-range')).toBe('bytes */10');
    });

    it('answers HEAD without a body', async () => {
        const res = await serve('vrs-asset://project/tape.mp3', { method: 'HEAD' });
        expect(res.status).toBe(200);
        expect(res.headers.get('content-length')).toBe('10');
        expect(await res.text()).toBe('');
    });

    it('refuses other methods', async () => {
        const res = await serve('vrs-asset://project/tape.mp3', { method: 'POST', body: 'x' });
        expect(res.status).toBe(405);
    });

    it('passes only the asset name to the resolver', async () => {
        const asked: string[] = [];
        const res = await handlerFor(async (name) => {
            asked.push(name);
            return file;
        })(new Request('vrs-asset://project/tape.mp3?v=2'));
        expect(res.status).toBe(200);
        expect(asked).toEqual(['tape.mp3']);
    });

    it('never resolves a URL that names no asset', async () => {
        let called = false;
        const res = await handlerFor(async () => {
            called = true;
            return file;
        })(new Request('vrs-asset://project/a/b.mp3'));
        expect(res.status).toBe(404);
        expect(called).toBe(false);
    });

    it.each([
        ['an invalid name', new ProjectFormatError('INVALID', 'Invalid asset name')],
        ['no open project', new ProjectFormatError('NO_PROJECT', 'No project is open.')],
    ])('answers 404 for %s', async (_label, error) => {
        const res = await handlerFor(async () => {
            throw error;
        })(new Request('vrs-asset://project/tape.mp3'));
        expect(res.status).toBe(404);
    });

    it('answers 404 for a missing file or a folder', async () => {
        expect((await handlerFor(async () => path.join(tmp, 'gone.mp3'))(new Request('vrs-asset://project/gone.mp3'))).status).toBe(404);
        expect((await handlerFor(async () => tmp)(new Request('vrs-asset://project/tape.mp3'))).status).toBe(404);
    });
});
