import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import type { Bible, Fact, TreeItem } from '@/project/types';
import { EntityCard, type EntityCardProps } from '@/components/bible/EntityCard';
import { emptyExtraction } from '@/extraction/types';

const base = (id: string, title: string, extra: Partial<TreeItem> = {}): TreeItem =>
  ({ id, parentId: null, type: 'document', title, order: 0, keywords: [], ...extra });
const fact = (over: Partial<Fact>): Fact => ({
  id: crypto.randomUUID(), entityId: 'e1', attribute: 'Role', value: 'x', status: 'kept', origin: 'manual',
  createdAt: 'T0', updatedAt: 'T0', ...over,
});
const src = (itemId: string, quote = 'q') => ({ itemId, quote, start: 0, end: quote.length });

const initialItems: TreeItem[] = [
  base('e1', 'Mara', { type: 'entity', entityKind: 'character', synopsis: 'The heir', references: [{ id: 'r1', targetId: 'e2' }] }),
  base('e2', 'Bryn', { type: 'entity', entityKind: 'character' }),
  base('ev', 'The fall', { type: 'entity', entityKind: 'event', references: [{ id: 'r2', targetId: 'e1' }] }),
  base('c1', 'Session 1', { type: 'chat' }),
  base('img', 'Sketch', { type: 'image' }),
];
const initialBible: Bible = {
  facts: [
    fact({ attribute: 'Role', value: 'heir', source: src('c1') }),
    fact({ attribute: 'Eyes', value: 'green', source: src('c1') }),
    fact({ attribute: 'Eyes', value: 'blue', status: 'proposed' }),
    fact({ attribute: 'Age', value: '24', status: 'proposed', source: src('c1', 'twenty-four') }),
  ],
  dependencies: [], decisions: [],
};

function Harness({ startBible = initialBible, ...over }: Partial<EntityCardProps> & { startBible?: Bible }) {
  const [bible, setBible] = useState(startBible);
  const [extraction, setExtraction] = useState(emptyExtraction());
  const [items, setItems] = useState(initialItems);
  const [body, setBody] = useState('Grew up in the keep.');
  const entity = items.find(i => i.id === 'e1')!;
  return (
    <EntityCard
      entity={entity}
      items={items}
      bible={bible}
      assets={null}
      bodyOf={(id) => (id === 'e1' ? body : 'twenty-four')}
      chatOf={() => undefined}
      updateBible={(u) => setBible(u)}
      extraction={extraction}
      updateCanon={(u) => {
        const next = u({ bible, extraction });
        setBible(next.bible);
        setExtraction(next.extraction);
      }}
      sourceOrder={['c0', 'c1']}
      onUpdateItem={(id, patch) => setItems(list => list.map(i => (i.id === id ? { ...i, ...patch } : i)))}
      onChangeBody={(_, text) => setBody(text)}
      onOpenSource={vi.fn()}
      onOpenItem={vi.fn()}
      onOpenCard={vi.fn()}
      onBack={vi.fn()}
      {...over}
    />
  );
}

const region = (name: string) => screen.getByRole('region', { name });

describe('EntityCard', () => {
  it('shows the header with counts, badges and an editable summary', () => {
    render(<Harness />);
    expect(screen.getByLabelText('Title')).toHaveValue('Mara');
    expect(screen.getByText('Character · in 1 source · 4 facts')).toBeInTheDocument();
    expect(screen.getByText('1 conflict')).toBeInTheDocument();
    expect(screen.getByText('2 to review')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Summary'), { target: { value: 'The exiled heir' } });
    expect(screen.getByLabelText('Summary')).toHaveValue('The exiled heir');
  });

  it('lists canon one line per attribute with its source count, and pins a line to the card', () => {
    render(<Harness />);
    const canon = region('Canon');
    expect(within(canon).getByText('heir')).toBeInTheDocument();
    expect(within(canon).getAllByText('1 source')).toHaveLength(2);
    fireEvent.click(within(canon).getByRole('button', { name: 'Pin Eyes to the card' }));
    expect(within(canon).getByRole('button', { name: 'Unpin Eyes from the card' })).toBeInTheDocument();
    // Pinned lines come first.
    expect(within(canon).getAllByRole('listitem')[0]).toHaveTextContent('Eyes');
  });

  it('resolves a conflict with one click and moves it out of Needs a decision', () => {
    render(<Harness />);
    const needs = region('Needs a decision');
    expect(within(needs).getByText('Eyes')).toBeInTheDocument();
    fireEvent.click(within(needs).getAllByRole('button', { name: 'Keep this one' })[1]);
    expect(within(region('Canon')).getByText('blue')).toBeInTheDocument();
    expect(within(region('Needs a decision')).queryByText('Keep this one')).toBeNull();
  });

  it('keeps or sets aside a proposed fact', () => {
    render(<Harness />);
    const needs = region('Needs a decision');
    const age = within(needs).getByText('24').closest('li')!;
    expect(within(age).getByText('twenty-four')).toBeInTheDocument();
    fireEvent.click(within(age).getByRole('button', { name: 'Keep' }));
    expect(within(region('Canon')).getByText('Age')).toBeInTheDocument();
  });

  it('edits the notes body', () => {
    render(<Harness />);
    fireEvent.change(screen.getByLabelText('Notes'), { target: { value: 'New notes' } });
    expect(screen.getByLabelText('Notes')).toHaveValue('New notes');
  });

  it('shows appears in, related and came from, each opening its target', () => {
    const onOpenCard = vi.fn();
    const onOpenItem = vi.fn();
    render(<Harness onOpenCard={onOpenCard} onOpenItem={onOpenItem} />);
    fireEvent.click(within(region('Appears in')).getByRole('button', { name: 'The fall' }));
    expect(onOpenCard).toHaveBeenCalledWith('ev');
    fireEvent.click(within(region('Related')).getByRole('button', { name: 'Bryn' }));
    expect(onOpenCard).toHaveBeenCalledWith('e2');
    fireEvent.click(within(region('Came from')).getByRole('button', { name: /Session 1/ }));
    expect(onOpenItem).toHaveBeenCalledWith('c1');
  });

  it('links an existing item and unlinks it', () => {
    render(<Harness />);
    fireEvent.change(screen.getByLabelText('Link an item'), { target: { value: 'img' } });
    expect(within(region('Images')).getByRole('button', { name: 'Open Sketch' })).toBeInTheDocument();
    fireEvent.click(within(region('Images')).getByRole('button', { name: 'Unlink Sketch' }));
    expect(screen.queryByRole('region', { name: 'Images' })).toBeNull();
  });

  it('adds a kept manual fact', () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Add fact' }));
    fireEvent.change(screen.getByLabelText('Attribute'), { target: { value: 'Hair' } });
    fireEvent.change(screen.getByLabelText('Value'), { target: { value: 'red' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save fact' }));
    expect(within(region('Canon')).getByText('red')).toBeInTheDocument();
  });
});

describe('EntityCard: extraction', () => {
  it('offers Keep the newer when the versions come from different sources', () => {
    const startBible: Bible = {
      ...initialBible,
      facts: [fact({ attribute: 'Eyes', value: 'green', status: 'proposed', source: src('c0') }), fact({ attribute: 'Eyes', value: 'blue', status: 'proposed', source: src('c1') })],
    };
    render(<Harness startBible={startBible} />);
    fireEvent.click(within(region('Needs a decision')).getByRole('button', { name: 'Keep the newer' }));
    expect(within(region('Canon')).getByText('blue')).toBeInTheDocument();
  });

  it('lists rejections with AI on and lifts one back into review', () => {
    const startBible: Bible = { ...initialBible, facts: [fact({ attribute: 'Hair', value: 'red', status: 'set_aside', origin: 'ai' })] };
    render(<Harness startBible={startBible} aiEnabled />);
    const rejected = region('Rejected');
    expect(within(rejected).getByText('Hair: red')).toBeInTheDocument();
    fireEvent.click(within(rejected).getByRole('button', { name: 'Lift rejection of Hair: red' }));
    expect(within(region('Needs a decision')).getByText('red')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Rejected' })).toBeNull();
  });

  it('hides the Rejected list while AI is off', () => {
    const startBible: Bible = { ...initialBible, facts: [fact({ attribute: 'Hair', value: 'red', status: 'set_aside' })] };
    render(<Harness startBible={startBible} />);
    expect(screen.queryByRole('region', { name: 'Rejected' })).toBeNull();
  });
});
