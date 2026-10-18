import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import type { ModelInfo } from '@/ai/types';
import type { Fact, TreeItem } from '@/project/types';
import type { LiveFlag } from '@/extraction/conflictCheck';
import type { ConflictCheckRun, ConflictCheckStatus } from '@/extraction/useConflictCheck';
import { ConflictCheckModal, ConflictFlagList, type ConflictCheckModalProps } from '@/components/extraction/ConflictCheck';

const CAPS = { webSearch: false, readUrls: false, temperature: true };
const MODELS: ModelInfo[] = [{ id: 'g-flash', name: 'Gemini Flash', capabilities: CAPS }];
const entity = (id: string, title: string): TreeItem => ({ id, parentId: null, type: 'entity', title, order: 0, keywords: [], entityKind: 'character' });
const fact = (id: string, entityId: string, attribute: string, value: string): Fact =>
  ({ id, entityId, attribute, value, status: 'kept', origin: 'manual', createdAt: 'T', updatedAt: 'T' });
const ITEMS = [entity('mara', 'Mara'), entity('ivo', 'Ivo')];
const FLAG: LiveFlag = {
  flag: { id: 'g1', factIds: ['f1', 'f2'], reason: 'Ivo cannot be her father and younger than her.', fingerprint: 'fp', at: 'T' },
  facts: [fact('f1', 'mara', 'father', 'Ivo'), fact('f2', 'ivo', 'age', '12')],
};
const run = (status: ConflictCheckStatus): ConflictCheckRun => ({ status, start: vi.fn(), cancel: vi.fn(), reset: vi.fn() });

describe('ConflictFlagList', () => {
  it('shows both facts with their entities and the reason, and offers dismiss and set aside', () => {
    const onDismiss = vi.fn();
    const onSetAside = vi.fn();
    const onOpenCard = vi.fn();
    render(<ConflictFlagList flags={[FLAG]} items={ITEMS} onDismiss={onDismiss} onSetAside={onSetAside} onOpenCard={onOpenCard} />);
    const flag = within(screen.getByRole('list', { name: 'Possible conflicts' })).getAllByRole('listitem')[0];
    expect(within(flag).getByText(FLAG.flag.reason)).toBeInTheDocument();
    expect(within(flag).getByText('father: Ivo')).toBeInTheDocument();
    expect(within(flag).getByText('age: 12')).toBeInTheDocument();
    fireEvent.click(within(flag).getByRole('button', { name: 'Ivo' }));
    expect(onOpenCard).toHaveBeenCalledWith('ivo');
    fireEvent.click(within(flag).getByRole('button', { name: 'Set aside age: 12' }));
    expect(onSetAside).toHaveBeenCalledWith('f2');
    fireEvent.click(within(flag).getByRole('button', { name: 'Dismiss' }));
    expect(onDismiss).toHaveBeenCalledWith(FLAG.flag);
  });
});

function setup(over: Partial<ConflictCheckModalProps> = {}) {
  const props: ConflictCheckModalProps = {
    scopeLabel: 'Characters',
    estimate: { facts: 12, total: 12, tokens: 340 },
    defaultProvider: 'gemini',
    defaultModel: 'g-flash',
    configuredProviders: ['gemini'],
    models: () => MODELS,
    loadModels: vi.fn(async () => MODELS),
    check: run({ state: 'idle' }),
    flags: [],
    items: ITEMS,
    onStart: vi.fn(),
    onDismiss: vi.fn(),
    onSetAside: vi.fn(),
    onOpenCard: vi.fn(),
    onClose: vi.fn(),
    ...over,
  };
  render(<ConflictCheckModal {...props} />);
  return props;
}

describe('ConflictCheckModal', () => {
  it('shows the estimate first and starts with the chosen model', () => {
    const props = setup();
    const dialog = screen.getByRole('dialog', { name: 'Check for conflicts: Characters' });
    expect(within(dialog).getByText('12 facts · ~340 tokens · Gemini Flash')).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Start' }));
    expect(props.onStart).toHaveBeenCalledWith('gemini', 'g-flash');
  });

  it('says when the scope has more facts than one check sends, and refuses fewer than two', () => {
    setup({ estimate: { facts: 300, total: 412, tokens: 9000 } });
    expect(screen.getByText(/Only the first 300 of 412 facts/)).toBeInTheDocument();
  });

  it('cannot start with fewer than two facts', () => {
    setup({ estimate: { facts: 1, total: 1, tokens: 20 } });
    expect(screen.getByRole('button', { name: 'Start' })).toBeDisabled();
  });

  it('can be cancelled while running', () => {
    const check = run({ state: 'running' });
    setup({ check });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel check' }));
    expect(check.cancel).toHaveBeenCalled();
  });

  it('lists the flags when done', () => {
    setup({ check: run({ state: 'done', added: 1 }), flags: [FLAG] });
    expect(screen.getByText('1 new possible conflict.')).toBeInTheDocument();
    expect(screen.getByText(FLAG.flag.reason)).toBeInTheDocument();
  });

  it('shows an error', () => {
    setup({ check: run({ state: 'error', message: 'Slow down' }) });
    expect(screen.getByText('Slow down')).toBeInTheDocument();
  });
});
