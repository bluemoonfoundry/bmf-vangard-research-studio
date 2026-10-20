import path from 'path';
import { ProjectFormatError } from './projectSchema.js';

/**
 * Media the binder can import, by kind. Only formats Chromium plays or shows
 * natively are listed; SVG is left out on purpose (it can carry script).
 */
export const MEDIA_KINDS = {
    image: { label: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'bmp'] },
    audio: { label: 'Audio', extensions: ['mp3', 'wav', 'ogg', 'oga', 'opus', 'm4a', 'aac', 'flac'] },
};

/**
 * Imports larger than this are refused. Assets are streamed to the renderer
 * (assetProtocol.js), so this only bounds how much a project folder grows per import.
 */
export const MAX_ASSET_BYTES = 4 * 1024 * 1024 * 1024;

const MIME_TYPES = {
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
    avif: 'image/avif', bmp: 'image/bmp',
    mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', oga: 'audio/ogg', opus: 'audio/ogg',
    m4a: 'audio/mp4', aac: 'audio/aac', flac: 'audio/flac',
};

/** The Content-Type served for an asset file name, by extension. */
export function mediaMimeType(name) {
    const ext = path.extname(String(name)).slice(1).toLowerCase();
    return Object.hasOwn(MIME_TYPES, ext) ? MIME_TYPES[ext] : 'application/octet-stream';
}

/** @returns {{ label: string, extensions: string[] }} */
export function mediaKind(kind) {
    if (!Object.hasOwn(MEDIA_KINDS, kind)) {
        throw new ProjectFormatError('INVALID', `Unknown media kind: ${String(kind)}`);
    }
    return MEDIA_KINDS[kind];
}

/** The lower-case extension of `filePath` if it's allowed for `kind`; throws UNSUPPORTED otherwise. */
export function mediaExtension(filePath, kind) {
    const ext = path.extname(String(filePath)).slice(1).toLowerCase();
    if (!mediaKind(kind).extensions.includes(ext)) {
        throw new ProjectFormatError('UNSUPPORTED', `${path.basename(String(filePath))} is not a supported ${kind} file.`);
    }
    return ext;
}

/** Native file-dialog filters for `kind`. */
export function dialogFilters(kind) {
    const { label, extensions } = mediaKind(kind);
    return [{ name: label, extensions }];
}
