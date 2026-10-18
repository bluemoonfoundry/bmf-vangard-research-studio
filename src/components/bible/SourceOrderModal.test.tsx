import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { SourceOrderModal } from '@/components/bible/SourceOrderModal';

const sources = [{ id: 'a', title: 'First chat' }, { id: 'b', title: 'Second chat' }, { id: 'c', title: 'Notes' }];

describe('SourceOrderModal', () => {
  it('saves the reordered list, oldest first', () => {
    const onSave = vi.fn();
    const onClose = vi.fn();
    render(<SourceOrderModal sources={sources} onSave={onSave} onClose={onClose} />);
    const dialog = screen.getByRole('dialog', { name: 'Source order' });
    expect(within(dialog).getByText(/Oldest at the top/)).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Move 1. First chat up' })).toBeDisabled();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Move 2. Second chat up' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Move 2. First chat down' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(onSave).toHaveBeenCalledWith(['b', 'c', 'a']);
    expect(onClose).toHaveBeenCalled();
  });

  it('tells same-titled versions apart by their file names', () => {
    render(<SourceOrderModal
      sources={[{ id: 'v1', title: 'Clouds', detail: 'clouds-2026-09-01.md' }, { id: 'v2', title: 'Clouds', detail: 'clouds-2026-10-18.md' }]}
      onSave={vi.fn()} onClose={vi.fn()}
    />);
    expect(screen.getByText('clouds-2026-09-01.md')).toBeInTheDocument();
    expect(screen.getByText('clouds-2026-10-18.md')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Move 2. Clouds up' })).toBeEnabled();
  });

  it('does not save on cancel', () => {
    const onSave = vi.fn();
    render(<SourceOrderModal sources={sources} onSave={onSave} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onSave).not.toHaveBeenCalled();
  });

  it('explains when there are no sources yet', () => {
    render(<SourceOrderModal sources={[]} onSave={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByText(/No chats or documents yet/)).toBeInTheDocument();
  });
});
