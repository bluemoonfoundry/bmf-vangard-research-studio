import fs from 'fs/promises';
import path from 'path';
import { ProjectFormatError } from './projectSchema.js';

export const TEXT_IMPORT_EXTENSIONS = ['txt', 'md', 'markdown'];

/** Transcripts larger than this are refused: they are read whole into the renderer. */
export const MAX_TEXT_IMPORT_BYTES = 5 * 1024 * 1024;

/**
 * Reads a chat transcript picked in the native dialog. The text is returned with any BOM removed
 * and LF line endings.
 * @returns {Promise<{ title: string, text: string, fileName: string }>}
 */
export async function readTextImport(filePath, { maxBytes = MAX_TEXT_IMPORT_BYTES } = {}) {
    const fileName = path.basename(String(filePath));
    const ext = path.extname(fileName).slice(1).toLowerCase();
    if (!TEXT_IMPORT_EXTENSIONS.includes(ext)) {
        throw new ProjectFormatError('UNSUPPORTED', `${fileName} is not a supported text file.`);
    }
    const { size } = await fs.stat(filePath);
    if (size > maxBytes) {
        throw new ProjectFormatError('TOO_LARGE', `${fileName} is larger than the ${Math.round(maxBytes / (1024 * 1024))} MB import limit.`);
    }
    const raw = await fs.readFile(filePath, 'utf8');
    const text = raw.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
    return { title: path.basename(fileName, path.extname(fileName)), text, fileName };
}
