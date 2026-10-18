/**
 * Minimal Server-Sent Events reader over a byte stream.
 * @param {ReadableStream<Uint8Array>} stream
 * @returns {AsyncGenerator<{ event: string | null, data: string }>}
 */
export async function* readSse(stream) {
    const reader = stream.getReader();
    const decoder = new globalThis.TextDecoder('utf-8');
    let buffer = '';
    /** @type {string | null} */
    let event = null;
    /** @type {string[]} */
    let data = [];

    /** @param {string} line @returns {{ event: string | null, data: string } | null} */
    function feed(line) {
        if (line === '') {
            if (data.length === 0) {
                event = null;
                return null;
            }
            const out = { event, data: data.join('\n') };
            event = null;
            data = [];
            return out;
        }
        if (line.startsWith(':')) return null;
        const i = line.indexOf(':');
        const field = i === -1 ? line : line.slice(0, i);
        let value = i === -1 ? '' : line.slice(i + 1);
        if (value.startsWith(' ')) value = value.slice(1);
        if (field === 'event') event = value;
        else if (field === 'data') data.push(value);
        return null;
    }

    try {
        for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            let m;
            while ((m = /\r\n|\n|\r/.exec(buffer))) {
                // A trailing lone \r may be half of a CRLF; wait for more input.
                if (m[0] === '\r' && m.index + 1 === buffer.length) break;
                const line = buffer.slice(0, m.index);
                buffer = buffer.slice(m.index + m[0].length);
                const out = feed(line);
                if (out) yield out;
            }
        }
        buffer += decoder.decode();
        for (const line of buffer.split(/\r\n|\n|\r/)) {
            const out = feed(line);
            if (out) yield out;
        }
        const last = feed('');
        if (last) yield last;
    } finally {
        reader.releaseLock();
    }
}
