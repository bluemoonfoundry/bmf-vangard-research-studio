import { useEffect, useState } from 'react';
import { PROVIDERS, type ModelInfo, type ProviderId } from '@/ai/types';
import { fieldLabel, input } from '@/components/workspace/ui';

/** The provider and model choice shared by the Extract and conflict check dialogs. */

export interface ModelSource {
  defaultProvider: ProviderId | null;
  defaultModel: string | null;
  configuredProviders: ProviderId[];
  models(provider: ProviderId): ModelInfo[] | undefined;
  loadModels(provider: ProviderId): Promise<ModelInfo[]>;
}

export interface ModelChoice {
  provider: ProviderId | null;
  setProvider(p: ProviderId): void;
  /** The provider's models, or undefined while they load. */
  listed: ModelInfo[] | undefined;
  /** The chosen model, else the first listed. */
  model: ModelInfo | undefined;
  setModelId(id: string): void;
}

/** Starts on the default provider and model when configured, and loads the provider's models. */
export function useModelChoice(s: ModelSource): ModelChoice {
  const { configuredProviders, models, loadModels } = s;
  const [provider, setProviderState] = useState<ProviderId | null>(
    s.defaultProvider && configuredProviders.includes(s.defaultProvider) ? s.defaultProvider : configuredProviders[0] ?? null,
  );
  const listed = provider ? models(provider) : undefined;
  const [modelId, setModelId] = useState<string | null>(s.defaultModel);

  useEffect(() => {
    if (provider && !listed) void loadModels(provider).catch(() => {});
  }, [provider, listed, loadModels]);

  return {
    provider,
    setProvider: (p) => { setProviderState(p); setModelId(null); },
    listed,
    model: listed?.find(m => m.id === modelId) ?? listed?.[0],
    setModelId,
  };
}

export function ModelPicker({ choice, configuredProviders }: { choice: ModelChoice; configuredProviders: ProviderId[] }) {
  const { provider, listed, model } = choice;
  return (
    <div className="flex flex-wrap gap-3">
      <label className="flex flex-col gap-1">
        <span className={fieldLabel}>Provider</span>
        <select aria-label="Provider" className={input} value={provider ?? ''} onChange={(e) => choice.setProvider(e.target.value as ProviderId)}>
          {configuredProviders.map(p => <option key={p} value={p}>{PROVIDERS.find(x => x.id === p)?.name ?? p}</option>)}
        </select>
      </label>
      <label className="flex min-w-0 flex-1 flex-col gap-1">
        <span className={fieldLabel}>Model</span>
        <select aria-label="Model" className={input} value={model?.id ?? ''} onChange={(e) => choice.setModelId(e.target.value)} disabled={!listed?.length}>
          {!listed && <option value="">Loading models…</option>}
          {listed?.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select>
      </label>
    </div>
  );
}
