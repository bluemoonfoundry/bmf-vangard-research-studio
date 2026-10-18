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
    expect(within(dialog).getByRole('button', { name: 'Move First chat up' })).toBeDisabled();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Move Second chat up' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Move First chat down' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(onSave).toHaveBeenCalledWith(['b', 'c', 'a']);
    expect(onClose).toHaveBeenCalled();
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
