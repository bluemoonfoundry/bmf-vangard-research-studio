import { useId } from 'react';
import { Paperclip, RefreshCw, Sparkles } from 'lucide-react';
import { PROVIDERS, type ModelInfo, type ProviderId } from '@/ai/types';
import type { ChatFilterMode, ChatSettings } from '@/chat/types';
import { personaName } from '@/components/chat/PersonaDrawer';
import { btn, btnGhost, input, segment, segmentGroup } from '@/components/workspace/ui';

const FILTERS: { id: ChatFilterMode; name: string }[] = [
  { id: 'all', name: 'All' },
  { id: 'user_only', name: 'Mine' },
  { id: 'model_only', name: 'AI' },
];

interface ChatHeaderProps {
  title: string;
  onRename(title: string): void;
  settings: ChatSettings;
  onSettings(patch: Partial<ChatSettings>): void;
  /** False while AI is off: only the title and filter are shown. */
  editable: boolean;
  configuredProviders: ProviderId[];
  /** The provider's models, or undefined while they load. */
  models: ModelInfo[] | undefined;
  /** The chat's model, when it is listed. */
  model: ModelInfo | undefined;
  modelsLoading: boolean;
  /** Why the model list couldn't load, or null. */
  modelsError: string | null;
  /** Reloads the provider's models (also the Retry after a failure). */
  onRefreshModels(): void;
  personaOpen: boolean;
  onTogglePersona(): void;
  attachmentsOpen: boolean;
  onToggleAttachments(): void;
}

const providerName = (id: ProviderId) => PROVIDERS.find(p => p.id === id)?.name ?? id;

/** Title, filter, and (while AI is on) the provider/model picker, capability toggles, persona and temperature. */
export function ChatHeader(props: ChatHeaderProps) {
  const {
    title, onRename, settings, onSettings, editable, configuredProviders, models, model, modelsLoading, modelsError, onRefreshModels,
    personaOpen, onTogglePersona, attachmentsOpen, onToggleAttachments,
  } = props;
  const { provider } = settings;
  const caps = model?.capabilities;
  const providerListed = provider !== null && configuredProviders.includes(provider);
  const savedModelMissing = settings.model !== null && models !== undefined && !model;
  const temperatureId = useId();

  return (
    <div className="flex shrink-0 flex-col gap-2 border-b border-line px-4 py-2.5 text-xs">
      <div className="flex items-center justify-between gap-3">
        <input
          aria-label="Chat title"
          className="min-w-0 flex-1 border-b border-transparent bg-transparent pb-0.5 font-serif text-lg font-bold focus:border-accent focus:outline-none"
          value={title}
          placeholder="Untitled"
          onChange={(e) => onRename(e.target.value)}
        />
        <div className={segmentGroup} role="group" aria-label="Show messages">
          {FILTERS.map(f => (
            <button key={f.id} type="button" className={segment(settings.filterMode === f.id)} aria-pressed={settings.filterMode === f.id} onClick={() => onSettings({ filterMode: f.id })}>
              {f.name}
            </button>
          ))}
        </div>
      </div>

      {editable && (
        <div className="flex flex-wrap items-center gap-2">
          <select
            aria-label="Provider"
            className={input}
            value={provider ?? ''}
            onChange={(e) => onSettings({ provider: (e.target.value || null) as ProviderId | null, model: null })}
          >
            {!providerListed && <option value={provider ?? ''}>{provider ? `${providerName(provider)} (not set up)` : 'Choose a provider…'}</option>}
            {configuredProviders.map(p => <option key={p} value={p}>{providerName(p)}</option>)}
          </select>
          <select
            aria-label="Model"
            className={`${input} max-w-[16rem]`}
            value={settings.model ?? ''}
            disabled={!providerListed}
            onChange={(e) => onSettings({ model: e.target.value || null })}
          >
            {settings.model === null && <option value="">Choose a model…</option>}
            {settings.model !== null && !model && (
              <option value={settings.model}>{savedModelMissing ? `${settings.model} (unavailable)` : settings.model}</option>
            )}
            {models?.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
          <button type="button" className={btnGhost} aria-label="Refresh models" title="Refresh models" disabled={!providerListed} onClick={onRefreshModels}>
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
          {modelsLoading && <span role="status" className="text-content-muted">Loading models…</span>}
          {!modelsLoading && modelsError && (
            <span role="alert" className="inline-flex items-center gap-1.5 text-danger">
              Couldn&apos;t load models: {modelsError}
              <button type="button" className={btn} onClick={onRefreshModels}>Retry</button>
            </span>
          )}
          {caps?.webSearch && (
            <label className="inline-flex items-center gap-1">
              <input type="checkbox" checked={settings.webSearch} onChange={(e) => onSettings({ webSearch: e.target.checked })} /> Web search
            </label>
          )}
          {caps?.readUrls && (
            <label className="inline-flex items-center gap-1">
              <input type="checkbox" checked={settings.readUrls} onChange={(e) => onSettings({ readUrls: e.target.checked })} /> Read URLs
            </label>
          )}
          {caps?.temperature && (
            <span className="inline-flex items-center gap-1.5">
              <label htmlFor={temperatureId} className="text-content-muted">Temperature</label>
              <input
                id={temperatureId}
                type="range"
                min={0}
                max={2}
                step={0.1}
                value={settings.temperature ?? 1}
                onChange={(e) => onSettings({ temperature: Number(e.target.value) })}
                className="w-24 accent-[var(--color-accent)]"
              />
              <span className="w-12 font-mono tabular-nums">{settings.temperature === null ? 'default' : settings.temperature.toFixed(1)}</span>
              <button type="button" className={btnGhost} disabled={settings.temperature === null} onClick={() => onSettings({ temperature: null })}>
                Default
              </button>
            </span>
          )}
          <div className="ml-auto flex items-center gap-2">
            <button type="button" className={btn} aria-pressed={personaOpen} onClick={onTogglePersona}>
              <Sparkles className="h-3.5 w-3.5" /> Persona: {personaName(settings.personaId)}
            </button>
            <button type="button" className={btn} aria-pressed={attachmentsOpen} onClick={onToggleAttachments}>
              <Paperclip className="h-3.5 w-3.5" /> Attachments ({settings.attachments.length})
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
