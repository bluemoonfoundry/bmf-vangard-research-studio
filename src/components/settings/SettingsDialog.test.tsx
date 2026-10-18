import { useMemo } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { SettingsDialog } from '@/components/settings/SettingsDialog';
import { useAi } from '@/ai/useAi';
import { createAiApi } from '@/ai/aiApi';
import { createFakeBridge, makeAiStatus } from '@/test/fakeBridge';

type Made = ReturnType<typeof createFakeBridge>;

function Harness({ bridge }: { bridge: Made['bridge'] }) {
  const ai = useAi(useMemo(() => createAiApi(bridge), [bridge]));
  return <SettingsDialog ai={ai} onClose={() => {}} />;
}

async function setup(configure?: (f: Made['fake']) => void) {
  const made = createFakeBridge();
  configure?.(made.fake);
  render(<Harness bridge={made.bridge} />);
  await screen.findByRole('checkbox', { name: 'Enable AI features' });
  return made;
}

const keyBox = (name: string) => screen.getByLabelText(`${name} API key`) as HTMLInputElement;
const saveButton = (name: string) => within(keyBox(name).closest('li')!).getByRole('button', { name: 'Save & test' });

describe('SettingsDialog', () => {
  it('enable switch is disabled until a provider is tested', async () => {
    await setup();
    expect(screen.getByRole('checkbox', { name: 'Enable AI features' })).toBeDisabled();
    expect(screen.getByText('Add and test an API key first')).toBeInTheDocument();
  });

  it('enable switch is available once a provider has been tested', async () => {
    await setup(f => { f.ai.status.providers.openai = { configured: true, lastTestOk: '2026-10-01T00:00:00Z' }; });
    expect(screen.getByRole('checkbox', { name: 'Enable AI features' })).toBeEnabled();
  });

  it('save & test calls saveKey with the typed key and clears the input', async () => {
    const { bridge } = await setup();
    const box = keyBox('OpenAI');
    expect(box.type).toBe('password');
    fireEvent.change(box, { target: { value: 'sk-secret' } });
    fireEvent.click(saveButton('OpenAI'));
    await waitFor(() => expect(bridge.ai.saveKey).toHaveBeenCalledWith('openai', 'sk-secret'));
    expect(bridge.ai.testKey).not.toHaveBeenCalled();
    await waitFor(() => expect(keyBox('OpenAI').value).toBe(''));
    expect(screen.queryByDisplayValue('sk-secret')).toBeNull();
  });

  it('shows the provider error when the test fails', async () => {
    const { bridge } = await setup();
    bridge.ai.saveKey = vi.fn(() => Promise.resolve({ ok: false as const, error: { code: 'AUTH', message: 'Invalid API key' } }));
    fireEvent.change(keyBox('Anthropic Claude'), { target: { value: 'bad' } });
    fireEvent.click(saveButton('Anthropic Claude'));
    expect(await screen.findByText('Invalid API key')).toBeInTheDocument();
  });

  it('failed save leaves the typed key in place', async () => {
    const { bridge } = await setup();
    bridge.ai.saveKey = vi.fn(() => Promise.resolve({ ok: false as const, error: { code: 'AUTH', message: 'Key rejected' } }));
    fireEvent.change(keyBox('OpenAI'), { target: { value: 'sk-bad' } });
    fireEvent.click(saveButton('OpenAI'));
    expect(await screen.findByText('Key rejected')).toBeInTheDocument();
    expect(keyBox('OpenAI').value).toBe('sk-bad');
  });

  it('keeps Test again and Remove key for a stored key without secure storage', async () => {
    await setup(f => {
      f.ai.status.encryptionAvailable = false;
      f.ai.status.providers.gemini = { configured: true, lastTestOk: 'T0' };
    });
    expect(screen.getByRole('button', { name: 'Test again' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove key' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save & test' })).toBeNull();
  });

  it('shows the load error with a working Retry', async () => {
    const made = createFakeBridge();
    const original = made.bridge.ai.getSettings;
    made.bridge.ai.getSettings = vi.fn(() => Promise.resolve({ ok: false as const, error: { code: 'X', message: 'Cannot read settings' } }));
    render(<Harness bridge={made.bridge} />);
    expect(await screen.findByText('Cannot read settings')).toBeInTheDocument();
    made.bridge.ai.getSettings = original;
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await screen.findByRole('checkbox', { name: 'Enable AI features' });
  });

  it('says AI is desktop-only when there is no bridge api', () => {
    function NoApi() {
      return <SettingsDialog ai={useAi(null)} onClose={() => {}} />;
    }
    render(<NoApi />);
    expect(screen.getByText('AI settings are only available in the desktop app.')).toBeInTheDocument();
  });

  it('Escape in the remove confirmation closes only the confirmation', async () => {
    await setup(f => { f.ai.status.providers.gemini = { configured: true, lastTestOk: 'T0' }; });
    fireEvent.click(screen.getByRole('button', { name: 'Remove key' }));
    const confirm = await screen.findByRole('dialog', { name: 'Remove API key' });
    fireEvent.keyDown(within(confirm).getByRole('button', { name: 'Cancel' }), { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Remove API key' })).toBeNull();
    expect(screen.getByRole('dialog', { name: 'Settings' })).toBeInTheDocument();
  });

  it('remove key asks for confirmation', async () => {
    const { bridge } = await setup(f => { f.ai.status.providers.gemini = { configured: true, lastTestOk: 'T0' }; });
    fireEvent.click(screen.getByRole('button', { name: 'Remove key' }));
    expect(bridge.ai.removeKey).not.toHaveBeenCalled();
    const confirm = await screen.findByRole('dialog', { name: 'Remove API key' });
    fireEvent.click(within(confirm).getByRole('button', { name: 'Remove key' }));
    await waitFor(() => expect(bridge.ai.removeKey).toHaveBeenCalledWith('gemini'));
    await waitFor(() => expect(screen.getAllByText('Not set')).toHaveLength(3));
  });

  it('default model list comes from the provider', async () => {
    const caps = { webSearch: false, readUrls: false, temperature: true };
    const { bridge } = await setup(f => {
      f.ai.status = makeAiStatus({
        enabled: true,
        defaultProvider: 'openai',
        providers: {
          gemini: { configured: false, lastTestOk: null },
          anthropic: { configured: false, lastTestOk: null },
          openai: { configured: true, lastTestOk: 'T0' },
        },
      });
      f.ai.models.openai = [{ id: 'gpt-x', name: 'GPT X', capabilities: caps }];
    });
    expect(await screen.findByRole('option', { name: 'GPT X' })).toBeInTheDocument();
    expect(bridge.ai.listModels).toHaveBeenCalledWith('openai', undefined);
    const providerSelect = screen.getByLabelText('Default provider');
    expect(within(providerSelect).queryByRole('option', { name: 'Google Gemini' })).toBeNull();
  });

  it('no key input when secure storage is unavailable', async () => {
    await setup(f => { f.ai.status.encryptionAvailable = false; });
    expect(screen.queryByLabelText('OpenAI API key')).toBeNull();
    expect(screen.getByText("This system has no secure key storage, so VRS can't store API keys.")).toBeInTheDocument();
  });

  it('shows a key store problem prominently', async () => {
    await setup(f => { f.ai.status.keyStoreProblem = 'Stored keys could not be read.'; });
    expect(screen.getByRole('alert')).toHaveTextContent('Stored keys could not be read.');
  });

  it('reset stored keys asks first, then clears the key store problem', async () => {
    const { bridge } = await setup(f => { f.ai.status.keyStoreProblem = 'Stored keys could not be read.'; });
    fireEvent.click(screen.getByRole('button', { name: 'Reset stored keys' }));
    const dialog = screen.getByRole('dialog', { name: 'Reset stored keys' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(bridge.ai.resetKeys).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Reset stored keys' }));
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Reset stored keys' })).getByRole('button', { name: 'Reset stored keys' }));
    await waitFor(() => expect(bridge.ai.resetKeys).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByText('Stored keys could not be read.')).toBeNull());
  });

  it('no reset button while the key store reads fine', async () => {
    await setup();
    expect(screen.queryByRole('button', { name: 'Reset stored keys' })).toBeNull();
  });
});
