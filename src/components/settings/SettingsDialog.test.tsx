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
    await waitFor(() => expect(bridge.ai.testKey).toHaveBeenCalledWith('openai'));
    await waitFor(() => expect(keyBox('OpenAI').value).toBe(''));
    expect(screen.queryByDisplayValue('sk-secret')).toBeNull();
  });

  it('shows the provider error when the test fails', async () => {
    const { bridge } = await setup();
    bridge.ai.testKey = vi.fn(() => Promise.resolve({ ok: false as const, error: { code: 'AUTH', message: 'Invalid API key' } }));
    fireEvent.change(keyBox('Anthropic Claude'), { target: { value: 'bad' } });
    fireEvent.click(saveButton('Anthropic Claude'));
    expect(await screen.findByText('Invalid API key')).toBeInTheDocument();
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
});
