import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import type { Bible, Fact, TreeItem } from '@/project/types';
import { CardWall } from '@/components/bible/CardWall';

const entity = (id: string, title: string, entityKind: string, extra: Partial<TreeItem> = {}): TreeItem =>
  ({ id, parentId: null, type: 'entity', entityKind, title, order: 0, keywords: [], ...extra });
const fact = (over: Partial<Fact>): Fact => ({
  id: crypto.randomUUID(), entityId: 'e1', attribute: 'Role', value: 'x', status: 'kept', origin: 'manual',
  createdAt: 'T0', updatedAt: 'T0', ...over,
});

const items = [
  entity('e1', 'Mara', 'character', { synopsis: 'The heir' }),
  entity('e2', 'Bryn', 'character'),
  entity('l1', 'Keep', 'location'),
];
const bible: Bible = {
  facts: [
    fact({ attribute: 'Role', value: 'heir' }),
    fact({ attribute: 'Eyes', value: 'green' }),
    fact({ attribute: 'Eyes', value: 'blue', status: 'proposed' }),
    fact({ attribute: 'Scar', value: 'left cheek', status: 'set_aside' }),
    fact({ entityId: 'e2', attribute: 'Role', value: 'guard' }),
  ],
  dependencies: [], decisions: [],
};

function renderWall(over: Partial<React.ComponentProps<typeof CardWall>> = {}) {
  const props = {
    items, bible, assets: null, tab: 'character' as const,
    onTab: vi.fn(), onOpenCard: vi.fn(), onNewEntity: vi.fn(), ...over,
  };
  render(<CardWall {...props} />);
  return props;
}

const card = (name: string) => within(screen.getByRole('list', { name: 'Cards' })).getByRole('button', { name: new RegExp(`^${name}`) });

describe('CardWall', () => {
  it('notes on a card when another character shares its name', () => {
    renderWall({ items: [...items, entity('e3', 'Mara Lind', 'character')] });
    expect(within(card('Mara(?! Lind)')).getByText('Shares "Mara" with Mara Lind')).toBeInTheDocument();
    expect(within(card('Bryn')).queryByText(/^Shares/)).toBeNull();
  });

  it('shows a tab per kind with counts and switches tabs', () => {
    const props = renderWall();
    expect(screen.getByRole('button', { name: 'Characters 2' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Locations 1' }));
    expect(props.onTab).toHaveBeenCalledWith('location');
  });

  it('shows kept facts and badges on each card, never set-aside facts', () => {
    renderWall();
    const mara = card('Mara');
    expect(within(mara).getByText('heir')).toBeInTheDocument();
    expect(within(mara).getByText('green')).toBeInTheDocument();
    expect(within(mara).queryByText('blue')).toBeNull();
    expect(within(mara).queryByText('left cheek')).toBeNull();
    expect(within(mara).getByText('1 conflict')).toBeInTheDocument();
    expect(within(mara).getByText('1 to review')).toBeInTheDocument();
    expect(within(card('Bryn')).getByText('all reviewed')).toBeInTheDocument();
  });

  it('opens a card and creates a new entity of the current kind', () => {
    const props = renderWall();
    fireEvent.click(card('Bryn'));
    expect(props.onOpenCard).toHaveBeenCalledWith('e2');
    fireEvent.click(screen.getByRole('button', { name: 'New character' }));
    expect(props.onNewEntity).toHaveBeenCalledWith('character');
  });

  it('says when a kind has no cards yet', () => {
    renderWall({ tab: 'faction' });
    expect(screen.getByText('No factions yet.')).toBeInTheDocument();
  });

  it('with AI on, checks the shown kind for conflicts and badges flagged cards', () => {
    const onCheckConflicts = vi.fn();
    renderWall({ aiEnabled: true, onCheckConflicts, flagCounts: new Map([['e2', 2]]) });
    expect(card('Bryn')).toHaveTextContent('2 flagged');
    fireEvent.click(screen.getByRole('button', { name: 'Check for conflicts' }));
    expect(onCheckConflicts).toHaveBeenCalledWith(['e2', 'e1'], 'Characters');
  });

  it('has no conflict check while AI is off', () => {
    renderWall({ onCheckConflicts: vi.fn(), flagCounts: new Map([['e2', 2]]) });
    expect(screen.queryByRole('button', { name: 'Check for conflicts' })).toBeNull();
    expect(card('Bryn')).not.toHaveTextContent('flagged');
  });
});
