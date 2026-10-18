import type { IpcResult } from '@/project/types';
import { unwrap } from '@/project/api';

type RawAiApi = VrsApi['ai'];

/** The preload's AI API with each `{ ok, value | error }` envelope unwrapped into a value or a thrown ProjectError. */
export type AiApi = {
  [K in keyof RawAiApi]: RawAiApi[K] extends (...args: infer A) => Promise<IpcResult<infer R>>
    ? (...args: A) => Promise<R>
    : RawAiApi[K];
};

export function createAiApi(bridge: VrsApi): AiApi {
  const raw = bridge.ai;
  return {
    getSettings: () => unwrap(raw.getSettings()),
    setSettings: (patch) => unwrap(raw.setSettings(patch)),
    saveKey: (provider, key) => unwrap(raw.saveKey(provider, key)),
    removeKey: (provider) => unwrap(raw.removeKey(provider)),
    resetKeys: () => unwrap(raw.resetKeys()),
    testKey: (provider) => unwrap(raw.testKey(provider)),
    listModels: (provider, options) => unwrap(raw.listModels(provider, options)),
    startChat: (requestId, request) => unwrap(raw.startChat(requestId, request)),
    cancelChat: (requestId) => unwrap(raw.cancelChat(requestId)),
    cancelAll: () => unwrap(raw.cancelAll()),
    onChatEvent: (callback) => raw.onChatEvent(callback),
    extract: (requestId, request) => unwrap(raw.extract(requestId, request)),
    cancelExtract: (requestId) => unwrap(raw.cancelExtract(requestId)),
  };
}
