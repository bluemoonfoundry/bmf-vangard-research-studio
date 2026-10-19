import fs from 'fs/promises';
import path from 'path';
import { TextDecoder } from 'util';
import { ProjectFormatError } from './projectSchema.js';

export const TEXT_IMPORT_EXTENSIONS = ['txt', 'md', 'markdown'];

/** Transcripts larger than this are refused: they are read whole into the renderer. */
export const MAX_TEXT_IMPORT_BYTES = 5 * 1024 * 1024;

/**
 * What counts as a file extension: a short run of letters and digits starting with a letter. Anything
 * else after the last dot ("Scene 2.1 draft", "Chapter 3.2") is part of an extensionless name.
 */
const EXTENSION = /^[a-z][a-z0-9]{0,9}$/i;

/** How much of a file is sampled to guess its encoding, and checked for NULs when it has no extension. */
const SNIFF_BYTES = 8192;

/**
 * Guesses a transcript's encoding: a BOM wins; otherwise text that is mostly ASCII saved as UTF-16
 * (Notepad's "Unicode", PowerShell 5's redirects) shows as NULs in every other byte. Anything else
 * is read as UTF-8.
 * @param {Buffer} bytes
 * @returns {'utf-8' | 'utf-16le' | 'utf-16be'}
 */
export function detectEncoding(bytes) {
    if (bytes[0] === 0xff && bytes[1] === 0xfe) return 'utf-16le';
    if (bytes[0] === 0xfe && bytes[1] === 0xff) return 'utf-16be';
    const pairs = Math.floor(Math.min(bytes.length, SNIFF_BYTES) / 2);
    if (pairs === 0) return 'utf-8';
    let evenNuls = 0;
    let oddNuls = 0;
    for (let i = 0; i < pairs * 2; i += 2) {
        if (bytes[i] === 0) evenNuls++;
        if (bytes[i + 1] === 0) oddNuls++;
    }
    if (oddNuls >= pairs * 0.4 && evenNuls <= pairs * 0.05) return 'utf-16le';
    if (evenNuls >= pairs * 0.4 && oddNuls <= pairs * 0.05) return 'utf-16be';
    return 'utf-8';
}

/**
 * Reads a chat transcript picked in the native dialog. The text is returned with any BOM removed
 * and LF line endings. UTF-16 files are decoded as such (see `detectEncoding`). Files with no
 * extension (AI Studio's Drive files have none) are accepted only when they decode cleanly as text.
 * @returns {Promise<{ title: string, text: string, fileName: string }>}
 */
export async function readTextImport(filePath, { maxBytes = MAX_TEXT_IMPORT_BYTES } = {}) {
    const fileName = path.basename(String(filePath));
    const dotted = path.extname(fileName).slice(1);
    const ext = EXTENSION.test(dotted) ? dotted.toLowerCase() : '';
    if (ext && !TEXT_IMPORT_EXTENSIONS.includes(ext)) {
        throw new ProjectFormatError('UNSUPPORTED', `${fileName} is not a supported text file.`);
    }
    const { size } = await fs.stat(filePath);
    if (size > maxBytes) {
        throw new ProjectFormatError('TOO_LARGE', `${fileName} is larger than the ${Math.round(maxBytes / (1024 * 1024))} MB import limit.`);
    }
    const bytes = await fs.readFile(filePath);
    const encoding = detectEncoding(bytes);
    let raw;
    if (ext) {
        raw = new TextDecoder(encoding).decode(bytes);
    } else {
        const notText = () => new ProjectFormatError('UNSUPPORTED', `${fileName} is not a text file.`);
        try {
            raw = new TextDecoder(encoding, { fatal: true }).decode(bytes);
        } catch {
            throw notText();
        }
        if (raw.slice(0, SNIFF_BYTES).includes('\0')) throw notText();
    }
    const text = raw.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
    return { title: ext ? path.basename(fileName, path.extname(fileName)) : fileName, text, fileName };
}

/**
 * Reads several picked transcripts in order. A file VRS can't import is reported in `skipped`
 * instead of failing the batch.
 * @param {string[]} filePaths
 * @param {{ maxBytes?: number }} [options]
 * @returns {Promise<{ imports: { title: string, text: string, fileName: string }[], skipped: { fileName: string, message: string }[] }>}
 */
export async function readTextImports(filePaths, options) {
    const imports = [];
    const skipped = [];
    for (const filePath of filePaths) {
        try {
            imports.push(await readTextImport(filePath, options));
        } catch (err) {
            const fileName = path.basename(String(filePath));
            if (err instanceof ProjectFormatError) {
                skipped.push({ fileName, message: err.message });
            } else if (typeof err?.code === 'string') {
                // A file system error (missing, locked, a folder, an online-only file) skips just that file.
                skipped.push({ fileName, message: `${fileName} couldn't be read (${err.code}).` });
            } else {
                throw err;
            }
        }
    }
    return { imports, skipped };
}
