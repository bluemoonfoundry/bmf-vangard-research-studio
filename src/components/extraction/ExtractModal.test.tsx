import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ModelInfo } from '@/ai/types';
import type { TreeItem } from '@/project/types';
import type { ExtractionRun } from '@/extraction/useExtraction';
import { ExtractModal, type ExtractModalProps } from '@/components/extraction/ExtractModal';

const CAPS = { webSearch: false, readUrls: false, temperature: true };
const MODELS: ModelInfo[] = [{ id: 'g-flash', name: 'Gemini Flash', capabilities: CAPS }, { id: 'g-pro', name: 'Gemini Pro', capabilities: CAPS }];
const src = (id: string, title: string, extra: Partial<TreeItem> = {}): TreeItem => ({ id, parentId: null, type: 'chat', title, order: 0, keywords: [], ...extra });
const idleRun = (): ExtractionRun => ({ running: false, statuses: [], start: vi.fn(), cancel: vi.fn() });

function setup(over: Partial<ExtractModalProps> = {}) {
  const props: ExtractModalProps = {
    sources: [src('s1', 'Harbour chat'), src('s2', 'Pasted notes', { type: 'document' })],
    initialIds: ['s1'],
    defaultProvider: 'gemini',
    defaultModel: 'g-pro',
    configuredProviders: ['gemini'],
    models: () => MODELS,
    loadModels: vi.fn(async () => MODELS),
    hasTurns: (id) => id === 's1',
    estimate: vi.fn((ids: string[]) => ({ tokens: ids.length * 1200, cached: ids.includes('s1') ? 1 : 0, empty: 0 })),
    run: idleRun(),
    onSetOwnWriting: vi.fn(),
    onReview: vi.fn(),
    onClose: vi.fn(),
    ...over,
  };
  const view = render(<ExtractModal {...props} />);
  const rerun = (run: ExtractionRun) => view.rerender(<ExtractModal {...props} run={run} />);
  return Object.assign(props, { rerun });
}

describe('ExtractModal', () => {
  it('preselects the given sources and shows the estimate with the default model', () => {
    setup();
    expect(screen.getByRole('checkbox', { name: 'Harbour chat' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Pasted notes' })).not.toBeChecked();
    expect(screen.getByText('1 source · ~1,200 tokens · 1 cached · Gemini Pro')).toBeInTheDocument();
  });

  it('marks a source without turns and lets the writer call it their own writing', async () => {
    const props = setup();
    expect(screen.getByText(/No turns found/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Pasted notes is my own writing' }));
    expect(props.onSetOwnWriting).toHaveBeenCalledWith('s2', true);
  });

  it('starts the run with the chosen sources and model', async () => {
    const props = setup();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Pasted notes' }));
    fireEvent.change(screen.getByRole('combobox', { name: 'Model' }), { target: { value: 'g-flash' } });
    fireEvent.click(screen.getByRole('button', { name: 'Start' }));
    expect(props.run.start).toHaveBeenCalledWith(['s1', 's2'], 'gemini', MODELS[0]);
  });

  it('cannot start with nothing chosen', async () => {
    setup({ initialIds: [] });
    expect(screen.getByRole('button', { name: 'Start' })).toBeDisabled();
  });

  it('shows progress and lets the writer cancel', () => {
    const running: ExtractionRun = { ...idleRun(), running: true, statuses: [{ itemId: 's1', title: 'Harbour chat', state: 'running' }] };
    setup({ run: running });
    expect(screen.getByText('Reading…')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel run' }));
    expect(running.cancel).toHaveBeenCalled();
  });

  it('opens on the source picker again after an earlier run finished', () => {
    setup({ run: { ...idleRun(), statuses: [{ itemId: 's1', title: 'Harbour chat', state: 'done' }] } });
    expect(screen.getByRole('button', { name: 'Start' })).toBeInTheDocument();
  });

  it('summarises a finished run', async () => {
    const done: ExtractionRun = {
      ...idleRun(),
      statuses: [
        { itemId: 's1', title: 'Harbour chat', state: 'done', summary: { facts: 2, merged: 1, suggested: 3, cards: 1, skipped: 0, dropped: 1 } },
        { itemId: 's2', title: 'Pasted notes', state: 'error', message: 'Slow down.' },
      ],
    };
    const props = setup({ run: { ...idleRun(), running: true, statuses: [{ itemId: 's1', title: 'Harbour chat', state: 'running' }] } });
    props.rerun(done);
    expect(screen.getByText('In all: 2 to review · 3 suggested · 1 new card · 1 merged · 1 dropped')).toBeInTheDocument();
    expect(screen.getByText('Slow down.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Review' }));
    expect(props.onReview).toHaveBeenCalled();
  });
});
