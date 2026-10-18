import fs from 'fs/promises';
import path from 'path';
import { TextDecoder } from 'util';
import { ProjectFormatError } from './projectSchema.js';

export const TEXT_IMPORT_EXTENSIONS = ['txt', 'md', 'markdown'];

/** Transcripts larger than this are refused: they are read whole into the renderer. */
export const MAX_TEXT_IMPORT_BYTES = 5 * 1024 * 1024;

/** How much of an extensionless file is checked for NUL bytes before it's decoded. */
const SNIFF_BYTES = 8192;

/**
 * Reads a chat transcript picked in the native dialog. The text is returned with any BOM removed
 * and LF line endings. Files with no extension (AI Studio's Drive files have none) are accepted
 * only when they're UTF-8 text.
 * @returns {Promise<{ title: string, text: string, fileName: string }>}
 */
export async function readTextImport(filePath, { maxBytes = MAX_TEXT_IMPORT_BYTES } = {}) {
    const fileName = path.basename(String(filePath));
    const ext = path.extname(fileName).slice(1).toLowerCase();
    if (ext && !TEXT_IMPORT_EXTENSIONS.includes(ext)) {
        throw new ProjectFormatError('UNSUPPORTED', `${fileName} is not a supported text file.`);
    }
    const { size } = await fs.stat(filePath);
    if (size > maxBytes) {
        throw new ProjectFormatError('TOO_LARGE', `${fileName} is larger than the ${Math.round(maxBytes / (1024 * 1024))} MB import limit.`);
    }
    const bytes = await fs.readFile(filePath);
    let raw;
    if (ext) {
        raw = bytes.toString('utf8');
    } else {
        const notText = () => new ProjectFormatError('UNSUPPORTED', `${fileName} is not a text file.`);
        if (bytes.subarray(0, SNIFF_BYTES).includes(0)) throw notText();
        try {
            raw = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
        } catch {
            throw notText();
        }
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
