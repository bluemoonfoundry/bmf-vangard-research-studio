import http from 'http';
import type { AddressInfo } from 'net';

/**
 * A local stand-in for the Google Gemini API (the shapes electron/lib/llm/providers/gemini.js reads), so AI specs
 * never contact a real provider. The app is pointed at it through VRS_LLM_BASE_URL (loopback http only).
 *
 *  - GET  /v1beta/models                                     -> the model list below
 *  - POST /v1beta/models/{model}:streamGenerateContent?alt=sse -> the configured reply as SSE `data:` chunks
 */

/** Models the fake lists. The embedding model lacks generateContent, so the app must leave it out. */
export const FAKE_MODELS = [
  { name: 'models/gemini-2.5-flash', displayName: 'Gemini 2.5 Flash', inputTokenLimit: 1_048_576, supportedGenerationMethods: ['generateContent', 'countTokens'] },
  { name: 'models/gemini-2.5-pro', displayName: 'Gemini 2.5 Pro', inputTokenLimit: 1_048_576, supportedGenerationMethods: ['generateContent', 'countTokens'] },
  { name: 'models/text-embedding-004', displayName: 'Text Embedding 004', supportedGenerationMethods: ['embedContent'] },
];

export interface StreamRequest {
  model: string;
  key: string;
  body: unknown;
}

export interface FakeProvider {
  /** The origin to pass as VRS_LLM_BASE_URL. */
  baseUrl: string;
  /** Every API key the app sent (x-goog-api-key), in order. */
  keys: string[];
  /** Every chat request the app sent, in order. */
  streams: StreamRequest[];
  /** The text chunks of each following reply (one SSE event per chunk). */
  setReply(chunks: string[]): void;
  /** Pause between chunks, in milliseconds. */
  setDelay(ms: number): void;
  /** Following replies send their first chunk, then wait for release() before sending the rest. */
  hold(): void;
  /** Lets held replies finish (and stops holding new ones). */
  release(): void;
  close(): Promise<void>;
}

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.setEncoding('utf-8');
    req.on('data', (chunk: string) => { data += chunk; });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

export async function startFakeProvider(): Promise<FakeProvider> {
  const keys: string[] = [];
  const streams: StreamRequest[] = [];
  let reply = ['Hello', ' from the fake provider.'];
  let delay = 0;
  let gate: Promise<void> | null = null;
  let openGate: (() => void) | null = null;

  const json = (res: http.ServerResponse, status: number, body: unknown) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  };

  const server = http.createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      const key = String(req.headers['x-goog-api-key'] ?? '');
      if (!key) {
        json(res, 403, { error: { code: 403, message: 'Missing API key.', status: 'PERMISSION_DENIED' } });
        return;
      }
      keys.push(key);

      if (req.method === 'GET' && url.pathname === '/v1beta/models') {
        json(res, 200, { models: FAKE_MODELS });
        return;
      }

      const stream = /^\/v1beta\/models\/([^/:]+):streamGenerateContent$/.exec(url.pathname);
      if (req.method === 'POST' && stream && url.searchParams.get('alt') === 'sse') {
        const model = decodeURIComponent(stream[1]);
        const raw = await readBody(req);
        streams.push({ model, key, body: JSON.parse(raw) });
        const chunks = [...reply];
        const held = gate;
        let gone = false;
        res.on('close', () => { gone = true; });
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
        for (let i = 0; i < chunks.length && !gone; i += 1) {
          if (i > 0 && delay) await wait(delay);
          if (i === 1 && held) await held;
          if (gone) break;
          const last = i === chunks.length - 1;
          const event = {
            candidates: [{ content: { role: 'model', parts: [{ text: chunks[i] }] }, index: 0, ...(last ? { finishReason: 'STOP' } : {}) }],
            ...(last ? { usageMetadata: { promptTokenCount: 10, candidatesTokenCount: chunks.length, totalTokenCount: 10 + chunks.length } } : {}),
            modelVersion: model,
          };
          res.write(`data: ${JSON.stringify(event)}\r\n\r\n`);
        }
        res.end();
        return;
      }

      json(res, 404, { error: { code: 404, message: `No route for ${req.method} ${url.pathname}`, status: 'NOT_FOUND' } });
    })().catch((err: unknown) => {
      if (!res.headersSent) json(res, 500, { error: { code: 500, message: String(err), status: 'INTERNAL' } });
      else res.end();
    });
  });

  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;

  const release = () => {
    openGate?.();
    gate = null;
    openGate = null;
  };

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    keys,
    streams,
    setReply(chunks) { reply = [...chunks]; },
    setDelay(ms) { delay = ms; },
    hold() {
      if (gate) return;
      gate = new Promise<void>(resolve => { openGate = resolve; });
    },
    release,
    close() {
      release();
      server.closeAllConnections();
      return new Promise<void>(resolve => server.close(() => resolve()));
    },
  };
}
