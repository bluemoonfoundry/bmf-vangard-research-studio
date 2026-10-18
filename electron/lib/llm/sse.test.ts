import { describe, it, expect } from 'vitest';
import { readSse } from './sse.js';

function streamOf(chunks: (string | Uint8Array)[]): ReadableStream<Uint8Array> {
    const enc = new TextEncoder();
    return new ReadableStream({
        start(c) {
            for (const ch of chunks) c.enqueue(typeof ch === 'string' ? enc.encode(ch) : ch);
            c.close();
        },
    });
}

async function collect(chunks: (string | Uint8Array)[]) {
    const out: { event: string | null; data: string }[] = [];
    for await (const e of readSse(streamOf(chunks))) out.push(e);
    return out;
}

describe('readSse', () => {
    it('parses events split across chunks', async () => {
        expect(await collect(['data: {"a"', ':1}\n\n'])).toEqual([{ event: null, data: '{"a":1}' }]);
    });
    it('joins multi-line data with \n', async () => {
        expect(await collect(['data: one\ndata: two\n\n'])).toEqual([{ event: null, data: 'one\ntwo' }]);
    });
    it('reads event names', async () => {
        expect(await collect(['event: ping\ndata: x\n\n'])).toEqual([{ event: 'ping', data: 'x' }]);
    });
    it('ignores comments', async () => {
        expect(await collect([': keepalive\ndata: x\n\n'])).toEqual([{ event: null, data: 'x' }]);
    });
    it('handles CRLF', async () => {
        expect(await collect(['event: a\r\ndata: x\r\n\r\ndata: y\r\n\r\n'])).toEqual([
            { event: 'a', data: 'x' },
            { event: null, data: 'y' },
        ]);
    });
    it('decodes a UTF-8 char split across chunks', async () => {
        const bytes = new TextEncoder().encode('data: é\n\n');
        const i = bytes.indexOf(0xc3) + 1;
        expect(await collect([bytes.slice(0, i), bytes.slice(i)])).toEqual([{ event: null, data: 'é' }]);
    });
    it('flushes a final event without a trailing blank line', async () => {
        expect(await collect(['data: x\n'])).toEqual([{ event: null, data: 'x' }]);
    });
});
