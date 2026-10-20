import { useCallback, useEffect, useRef, useState } from 'react';
import type { AiApi } from '@/ai/aiApi';
import type { AiSettingsPatch, AiStatus, ModelInfo, PersonaPreset, PersonaPresetInput, ProviderId } from '@/ai/types';

export interface AiController {
  /** False when there is no desktop bridge, so AI settings cannot be read or changed. */
  available: boolean;
  status: AiStatus | null;
  /** True only once the status has loaded and AI is switched on. */
  enabled: boolean;
  refresh(): Promise<void>;
  setSettings(patch: AiSettingsPatch): Promise<void>;
  saveKey(provider: ProviderId, key: string): Promise<boolean>;
  removeKey(provider: ProviderId): Promise<void>;
  /** Recovery for an unreadable key store: backs it up and starts with no keys. */
  resetKeys(): Promise<void>;
  testKey(provider: ProviderId): Promise<boolean>;
  /** Cached models for a provider, once loaded. */
  models(provider: ProviderId): ModelInfo[] | undefined;
  loadModels(provider: ProviderId, refresh?: boolean): Promise<ModelInfo[]>;
  /** Why the provider's last model-list load failed, or null. */
  modelsError(provider: ProviderId): string | null;
  /** The writer's saved AI Chat personas; empty while AI is off. */
  personas: PersonaPreset[];
  /** Creates or updates a preset; throws (with the main process's message) when refused. */
  savePersona(input: PersonaPresetInput): Promise<PersonaPreset>;
  deletePersona(id: string): Promise<void>;
  error: string | null;
}

const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Renderer state for the opt-in AI layer: status, per-provider model cache, and the last error. */
export function useAi(api: AiApi | null): AiController {
  const [status, setStatus] = useState<AiStatus | null>(null);
  const [modelCache, setModelCache] = useState<Partial<Record<ProviderId, ModelInfo[]>>>({});
  const [modelErrors, setModelErrors] = useState<Partial<Record<ProviderId, string>>>({});
  const [personas, setPersonas] = useState<PersonaPreset[]>([]);
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  /** Runs a call that resolves to the full status; adopts it, or records the error. Returns success. */
  const adopt = useCallback(async (call: () => Promise<AiStatus>): Promise<boolean> => {
    try {
      const next = await call();
      if (!alive.current) return false;
      setStatus({ ...next });
      setError(null);
      return true;
    } catch (e) {
      if (alive.current) setError(messageOf(e));
      return false;
    }
  }, []);

  const refresh = useCallback(async () => {
    if (api) await adopt(() => api.getSettings());
  }, [api, adopt]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const enabled = status?.enabled === true;

  // Presets are an AI feature: listed only while AI is on, forgotten when it turns off.
  useEffect(() => {
    if (!api || !enabled) {
      setPersonas([]);
      return;
    }
    let current = true;
    api.listPersonas().then(
      (list) => {
        if (current) setPersonas(list);
      },
      (e: unknown) => {
        if (current) setError(messageOf(e));
      },
    );
    return () => {
      current = false;
    };
  }, [api, enabled]);

  const loadModels = useCallback(async (provider: ProviderId, refreshList = false) => {
    if (!api) return [];
    try {
      const list = await api.listModels(provider, refreshList ? { refresh: true } : undefined);
      if (alive.current) {
        setModelCache(c => ({ ...c, [provider]: list }));
        setModelErrors(({ [provider]: _cleared, ...rest }) => rest);
        setError(null);
      }
      return list;
    } catch (e) {
      if (alive.current) {
        setModelErrors(m => ({ ...m, [provider]: messageOf(e) }));
        setError(messageOf(e));
      }
      return [];
    }
  }, [api]);

  // Stable between cache changes, so callers can memoize on them.
  const models = useCallback((provider: ProviderId) => modelCache[provider], [modelCache]);
  const modelsError = useCallback((provider: ProviderId) => modelErrors[provider] ?? null, [modelErrors]);

  return {
    available: api !== null,
    status,
    enabled,
    refresh,
    setSettings: async (patch) => {
      if (api) await adopt(() => api.setSettings(patch));
    },
    saveKey: async (provider, key) => {
      if (!api) return false;
      const saved = await adopt(() => api.saveKey(provider, key));
      // A new key may have different model access.
      if (saved) setModelCache(({ [provider]: _stale, ...rest }) => rest);
      return saved;
    },
    removeKey: async (provider) => {
      if (!api) return;
      if (await adopt(() => api.removeKey(provider))) {
        setModelCache(({ [provider]: _gone, ...rest }) => rest);
      }
    },
    resetKeys: async () => {
      if (api && await adopt(() => api.resetKeys())) setModelCache({});
    },
    testKey: (provider) => (api ? adopt(() => api.testKey(provider)) : Promise.resolve(false)),
    models,
    modelsError,
    loadModels,
    personas,
    savePersona: async (input) => {
      if (!api) throw new Error('AI is not available.');
      const { preset, presets } = await api.savePersona(input);
      if (alive.current) setPersonas(presets);
      return preset;
    },
    deletePersona: async (id) => {
      if (!api) return;
      const presets = await api.deletePersona(id);
      if (alive.current) setPersonas(presets);
    },
    error,
  };
}
