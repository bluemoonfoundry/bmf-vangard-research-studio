import { useEffect, useRef, useState } from 'react';
import { Modal } from '@/components/workspace/Modal';
import { ConfirmDialog } from '@/components/workspace/ConfirmDialog';
import { btn, btnPrimary, fieldLabel, input } from '@/components/workspace/ui';
import type { AiController } from '@/ai/useAi';
import { PROVIDERS, type ProviderId } from '@/ai/types';

interface SettingsDialogProps {
  ai: AiController;
  onClose(): void;
}

const select = `${input} w-full`;

function ProviderRow({ id, name, ai }: { id: ProviderId; name: string; ai: AiController }) {
  const keyInput = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const status = ai.status!;
  const provider = status.providers[id];
  const locked = !status.encryptionAvailable;

  const saveAndTest = async () => {
    // The key lives only in the (uncontrolled) input; it is read once here and cleared after a successful save.
    const el = keyInput.current;
    const key = el?.value.trim() ?? '';
    if (!el || !key) return;
    setBusy(true);
    try {
      if (await ai.saveKey(id, key)) {
        el.value = '';
        await ai.testKey(id);
      }
    } finally {
      setBusy(false);
    }
  };

  const testAgain = async () => {
    setBusy(true);
    try {
      await ai.testKey(id);
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className="rounded border border-line p-3">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold">{name}</h3>
        <span className="text-xs text-content-muted">
          {provider.configured
            ? `Key saved${provider.lastTestOk ? ` · tested ${new Date(provider.lastTestOk).toLocaleDateString()}` : ' · not tested'}`
            : 'Not set'}
        </span>
      </div>
      {!locked && (
        <div className="mt-2 flex items-center gap-2">
          <input
            ref={keyInput}
            type="password"
            autoComplete="off"
            spellCheck={false}
            aria-label={`${name} API key`}
            placeholder={provider.configured ? 'Enter a new key to replace' : 'Paste API key'}
            className={`${input} min-w-0 flex-1`}
            disabled={busy}
          />
          <button type="button" className={btnPrimary} onClick={() => void saveAndTest()} disabled={busy}>
            Save &amp; test
          </button>
          {provider.configured && (
            <>
              <button type="button" className={btn} onClick={() => void testAgain()} disabled={busy}>Test again</button>
              <button type="button" className={btn} onClick={() => setConfirmRemove(true)} disabled={busy}>Remove key</button>
            </>
          )}
        </div>
      )}
      {confirmRemove && (
        <ConfirmDialog
          title="Remove API key"
          message={`Remove the ${name} API key from this computer?`}
          confirmLabel="Remove key"
          onCancel={() => setConfirmRemove(false)}
          onConfirm={() => {
            setConfirmRemove(false);
            void ai.removeKey(id);
          }}
        />
      )}
    </li>
  );
}

/** App-level AI settings (spec §1): master switch, provider keys, default provider and model. */
export function SettingsDialog({ ai, onClose }: SettingsDialogProps) {
  const { status, loadModels } = ai;
  const defaultProvider = status?.defaultProvider ?? null;

  useEffect(() => {
    if (defaultProvider) void loadModels(defaultProvider);
  }, [defaultProvider, loadModels]);

  const configured = status ? PROVIDERS.filter(p => status.providers[p.id].configured) : [];
  const anyTested = status ? PROVIDERS.some(p => status.providers[p.id].lastTestOk) : false;
  const switchDisabled = !status || (!status.enabled && !anyTested);
  const models = defaultProvider ? ai.models(defaultProvider) : undefined;

  return (
    <Modal
      title="Settings"
      description="Optional AI features. Nothing is sent anywhere until you turn them on."
      onClose={onClose}
      width="max-w-2xl"
      footer={<button type="button" className={btn} onClick={onClose}>Close</button>}
    >
      {!status ? (
        <p className="text-sm text-content-muted">Loading…</p>
      ) : (
        <div className="space-y-4">
          {status.keyStoreProblem && (
            <p role="alert" className="rounded border border-red-500 bg-surface-sunken p-3 text-sm font-medium">
              {status.keyStoreProblem}
            </p>
          )}
          {ai.error && <p role="alert" className="rounded border border-red-500 p-3 text-sm">{ai.error}</p>}

          <div>
            <label className="flex items-center gap-2 text-sm font-medium">
              <input
                type="checkbox"
                checked={status.enabled}
                disabled={switchDisabled}
                onChange={(e) => void ai.setSettings({ enabled: e.target.checked })}
              />
              Enable AI features
            </label>
            {switchDisabled && <p className="mt-1 text-xs text-content-muted">Add and test an API key first</p>}
          </div>

          {!status.encryptionAvailable && (
            <p className="text-sm text-content-muted">This system has no secure key storage, so VRS can't store API keys.</p>
          )}

          <ul className="space-y-2" aria-label="Providers">
            {PROVIDERS.map(p => <ProviderRow key={p.id} id={p.id} name={p.name} ai={ai} />)}
          </ul>

          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className={fieldLabel}>Default provider</span>
              <select
                className={select}
                value={defaultProvider ?? ''}
                disabled={configured.length === 0}
                onChange={(e) => void ai.setSettings({
                  defaultProvider: (e.target.value || null) as ProviderId | null,
                  defaultModel: null,
                })}
              >
                <option value="">None</option>
                {configured.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </label>
            <label className="block">
              <span className={fieldLabel}>Default model</span>
              <select
                className={select}
                value={status.defaultModel ?? ''}
                disabled={!defaultProvider}
                onChange={(e) => void ai.setSettings({ defaultModel: e.target.value || null })}
              >
                <option value="">None</option>
                {status.defaultModel && !models?.some(m => m.id === status.defaultModel) && (
                  <option value={status.defaultModel}>{status.defaultModel}</option>
                )}
                {models?.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </label>
          </div>
        </div>
      )}
    </Modal>
  );
}
