import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import type { Bible, Fact, TreeItem } from '@/project/types';
import { emptyBible } from '@/bible/normalize';
import { EntityPanel } from '@/components/bible/EntityPanel';

const items: TreeItem[] = [
  { id: 'e1', parentId: null, type: 'entity', entityKind: 'character', title: 'Mara', order: 0, keywords: [] },
  { id: 'ev', parentId: null, type: 'entity', entityKind: 'event', title: 'The fall', order: 1, keywords: [] },
  { id: 'chat', parentId: null, type: 'chat', title: 'Session 1', order: 2, keywords: [] },
];

const proposed = (over: Partial<Fact> = {}): Fact => ({
  id: 'p1', entityId: 'e1', attribute: 'Eyes', value: 'green', status: 'proposed', origin: 'manual',
  source: { itemId: 'chat', quote: 'her green eyes', start: 0, end: 14 }, createdAt: 'T0', updatedAt: 'T0', ...over,
});

function Harness({ entity = items[0], initial = emptyBible(), onShowConflict, onOpenSource }: {
  entity?: TreeItem; initial?: Bible; onShowConflict?(k: string): void; onOpenSource?(s: unknown): void;
}) {
  const [bible, setBible] = useState(initial);
  return (
    <EntityPanel
      entity={entity}
      items={items}
      bible={bible}
      bodyOf={() => 'her green eyes'}
      updateBible={(u) => setBible(u)}
      onShowConflict={onShowConflict}
      onOpenSource={(onOpenSource ?? (() => undefined)) as never}
    />
  );
}

function addFact(attribute: string, value: string) {
  fireEvent.click(screen.getByRole('button', { name: 'Add fact' }));
  fireEvent.change(screen.getByLabelText('Attribute'), { target: { value: attribute } });
  fireEvent.change(screen.getByLabelText('Value'), { target: { value } });
  fireEvent.click(screen.getByRole('button', { name: 'Save fact' }));
}

describe('EntityPanel', () => {
  it('shows a manually added fact under Kept', () => {
    render(<Harness />);
    addFact('death', 'Season 3 finale');
    const kept = screen.getByRole('region', { name: 'Kept' });
    expect(within(kept).getByText('death')).toBeInTheDocument();
    expect(within(kept).getByText('Season 3 finale')).toBeInTheDocument();
  });

  it('marks a contradiction and reports its key', () => {
    const onShowConflict = vi.fn();
    render(<Harness onShowConflict={onShowConflict} />);
    addFact('death', 'Season 3 finale');
    expect(screen.queryByText(/conflicting values/i)).toBeNull();
    addFact('Death', 'Pilot');
    expect(screen.getByText(/conflicting values/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /conflict queue/i }));
    expect(onShowConflict).toHaveBeenCalledWith('e1\u0000death');
  });

  it('keeps, sets aside and restores a proposed fact', () => {
    render(<Harness initial={{ ...emptyBible(), facts: [proposed()] }} />);
    const pending = screen.getByRole('region', { name: 'Pending' });
    expect(within(pending).getByText('her green eyes')).toBeInTheDocument();
    fireEvent.click(within(pending).getByRole('button', { name: 'Set aside' }));
    expect(screen.queryByRole('region', { name: 'Pending' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Restore' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Set aside \(1\)/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Restore' }));
    expect(screen.getByRole('region', { name: 'Kept' })).toBeInTheDocument();
  });

  it('keeps a proposed fact and can mark it unreviewed again', () => {
    render(<Harness initial={{ ...emptyBible(), facts: [proposed()] }} />);
    fireEvent.click(within(screen.getByRole('region', { name: 'Pending' })).getByRole('button', { name: 'Keep' }));
    const kept = screen.getByRole('region', { name: 'Kept' });
    fireEvent.click(within(kept).getByRole('button', { name: 'Mark unreviewed' }));
    expect(screen.getByRole('region', { name: 'Pending' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Kept' })).toBeNull();
  });

  it('edits the attribute and value of a fact', () => {
    render(<Harness initial={{ ...emptyBible(), facts: [proposed({ status: 'kept' })] }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    fireEvent.change(screen.getByLabelText('Attribute'), { target: { value: 'Hair' } });
    fireEvent.change(screen.getByLabelText('Value'), { target: { value: 'red' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save fact' }));
    const kept = screen.getByRole('region', { name: 'Kept' });
    expect(within(kept).getByText('Hair')).toBeInTheDocument();
    expect(within(kept).getByText('red')).toBeInTheDocument();
    expect(within(kept).queryByText('Eyes')).toBeNull();
  });

  it('shows season, episode and order inputs for the when attribute', () => {
    render(<Harness entity={items[1]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Add fact' }));
    expect(screen.getByLabelText('Value')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Attribute'), { target: { value: 'when' } });
    expect(screen.queryByLabelText('Value')).toBeNull();
    fireEvent.change(screen.getByLabelText('Season'), { target: { value: '2' } });
    fireEvent.change(screen.getByLabelText('Episode'), { target: { value: '5' } });
    expect(screen.getByLabelText('Order')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Save fact' }));
    expect(within(screen.getByRole('region', { name: 'Kept' })).getByText('S2 · E5')).toBeInTheDocument();
  });

  it('opens the source of a fact', () => {
    const onOpenSource = vi.fn();
    render(<Harness initial={{ ...emptyBible(), facts: [proposed()] }} onOpenSource={onOpenSource} />);
    fireEvent.click(screen.getByRole('button', { name: /Session 1/ }));
    expect(onOpenSource).toHaveBeenCalledWith(expect.objectContaining({ itemId: 'chat' }));
  });
});
