import fs from 'fs';
import fsp from 'fs/promises';
import { Readable } from 'stream';
import { mediaMimeType } from './media.js';
import { isValidAssetName } from './projectSchema.js';

/**
 * Serves imported media to the renderer as `vrs-asset://project/<asset>`, so
 * long audio streams with range requests instead of crossing IPC whole.
 *
 * The URL carries only an asset name (checked with isValidAssetName); the file
 * is resolved by the caller against the open project root on every request,
 * with the same validateProjectPath guard as every other project read. The
 * scheme is registered privileged (standard, secure, stream) but without
 * bypassCSP, fetch or CORS: the CSP lists it for img-src and media-src only.
 */
export const ASSET_SCHEME = 'vrs-asset';
const ASSET_HOST = 'project';

/** Registration for protocol.registerSchemesAsPrivileged, called before the app is ready. */
export const ASSET_SCHEME_PRIVILEGES = { scheme: ASSET_SCHEME, privileges: { standard: true, secure: true, stream: true } };

/** The URL for an asset; `version` changes when the file changes on disk, so elements reload it. */
export function assetUrl(name, version = 0) {
    return `${ASSET_SCHEME}://${ASSET_HOST}/${encodeURIComponent(name)}?v=${version}`;
}

/** The asset name a request URL names, or null. */
export function assetNameFromUrl(url) {
    let parsed;
    try {
        parsed = new URL(url);
    } catch {
        return null;
    }
    if (parsed.protocol !== `${ASSET_SCHEME}:` || parsed.host !== ASSET_HOST) return null;
    let name;
    try {
        name = decodeURIComponent(parsed.pathname.slice(1));
    } catch {
        return null;
    }
    return isValidAssetName(name) ? name : null;
}

/**
 * The single byte range a Range header asks for, clamped to `size`; null when
 * there is none or it can't be read (the whole file is sent), 'unsatisfiable'
 * when it starts past the end. Multi-range requests get the whole file.
 *
 * @returns {{ start: number, end: number } | null | 'unsatisfiable'}
 */
export function parseRange(header, size) {
    if (typeof header !== 'string') return null;
    const match = /^\s*bytes\s*=\s*(\d*)\s*-\s*(\d*)\s*$/.exec(header);
    if (!match || (match[1] === '' && match[2] === '')) return null;
    if (match[1] === '') {
        const suffix = Number(match[2]);
        if (suffix === 0) return null;
        if (size === 0) return 'unsatisfiable';
        return { start: Math.max(0, size - suffix), end: size - 1 };
    }
    const start = Number(match[1]);
    const end = match[2] === '' ? Infinity : Number(match[2]);
    if (end < start) return null;
    if (start >= size) return 'unsatisfiable';
    return { start, end: Math.min(end, size - 1) };
}

const notFound = () => new Response('Not found', { status: 404 });

/**
 * A protocol.handle handler. `resolveAsset(name)` returns the validated path
 * of an asset in the open project, or throws (no project, invalid name).
 *
 * @param {{ resolveAsset: (name: string) => Promise<string> }} deps
 * @returns {(request: Request) => Promise<Response>}
 */
export function createAssetProtocolHandler({ resolveAsset }) {
    return async (request) => {
        if (request.method !== 'GET' && request.method !== 'HEAD') {
            return new Response('Method not allowed', { status: 405, headers: { Allow: 'GET, HEAD' } });
        }
        const name = assetNameFromUrl(request.url);
        if (!name) return notFound();

        let file;
        let size;
        try {
            file = await resolveAsset(name);
            const stats = await fsp.stat(file);
            if (!stats.isFile()) return notFound();
            size = stats.size;
        } catch {
            // No project open, an invalid name or a missing file: the renderer reports these via project:check-asset.
            return notFound();
        }

        const headers = {
            'Content-Type': mediaMimeType(name),
            'Accept-Ranges': 'bytes',
            'Cache-Control': 'no-store',
            'X-Content-Type-Options': 'nosniff',
        };
        const range = parseRange(request.headers.get('range'), size);
        if (range === 'unsatisfiable') {
            return new Response(null, { status: 416, headers: { ...headers, 'Content-Range': `bytes */${size}` } });
        }
        const { start, end } = range ?? { start: 0, end: size - 1 };
        const length = end - start + 1;
        const status = range ? 206 : 200;
        const responseHeaders = { ...headers, 'Content-Length': String(Math.max(0, length)) };
        if (range) responseHeaders['Content-Range'] = `bytes ${start}-${end}/${size}`;

        if (request.method === 'HEAD' || length <= 0) return new Response(null, { status, headers: responseHeaders });
        const body = Readable.toWeb(fs.createReadStream(file, { start, end }));
        return new Response(body, { status, headers: responseHeaders });
    };
}
