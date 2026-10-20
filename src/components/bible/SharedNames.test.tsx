import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { TreeItem } from '@/project/types';
import { SharedNames } from '@/components/bible/SharedNames';
import { AddItemModal } from '@/components/workspace/AddItemModal';

const ent = (id: string, title: string): TreeItem =>
  ({ id, parentId: null, type: 'entity', entityKind: 'character', title, order: 0, keywords: [] });
const items = [ent('a', 'Anna Smith'), ent('b', 'Ben Smith'), ent('c', 'Cora Lind')];

describe('SharedNames', () => {
  it('lists the other characters sharing a name and opens one', () => {
    const onOpen = vi.fn();
    render(<SharedNames entity={items[0]} items={items} onOpen={onOpen} />);
    expect(screen.getByText(/Shares "Smith" with/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Ben Smith' }));
    expect(onOpen).toHaveBeenCalledWith('b');
  });

  it('shows plain names without onOpen, and nothing for a unique name', () => {
    const { container } = render(<SharedNames entity={items[2]} items={items} />);
    expect(container).toBeEmptyDOMElement();
    render(<SharedNames entity={items[1]} items={items} />);
    expect(screen.getByText('Shares "Smith" with Anna Smith')).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
  });
});

describe('AddItemModal', () => {
  it('warns, without blocking, when a new character shares a name', () => {
    const onCreate = vi.fn();
    render(
      <AddItemModal
        initialType="entity" initialParentId={null} items={items} assets={null} aiEnabled={false}
        importMedia={() => Promise.resolve(null)} discardAsset={() => {}} onCreate={onCreate} onClose={() => {}}
      />,
    );
    fireEvent.change(screen.getByPlaceholderText('e.g. Harbour regulations of 1684'), { target: { value: 'Dora Smith' } });
    expect(screen.getByText('Another character is also called "Smith": Anna Smith, Ben Smith.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    expect(onCreate).toHaveBeenCalled();
  });
});
