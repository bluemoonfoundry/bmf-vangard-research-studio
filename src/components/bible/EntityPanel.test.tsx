import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import type { Bible, Fact, TreeItem } from '@/project/types';
import { emptyBible } from '@/bible/normalize';
import { EntityPanel } from '@/components/bible/EntityPanel';
import type { ChatOf, ChatTranscript } from '@/chat/types';

const items: TreeItem[] = [
  { id: 'e1', parentId: null, type: 'entity', entityKind: 'character', title: 'Mara', order: 0, keywords: [] },
  { id: 'ev', parentId: null, type: 'entity', entityKind: 'event', title: 'The fall', order: 1, keywords: [] },
  { id: 'chat', parentId: null, type: 'chat', title: 'Session 1', order: 2, keywords: [] },
];

const proposed = (over: Partial<Fact> = {}): Fact => ({
  id: 'p1', entityId: 'e1', attribute: 'Eyes', value: 'green', status: 'proposed', origin: 'manual',
  source: { itemId: 'chat', quote: 'her green eyes', start: 0, end: 14 }, createdAt: 'T0', updatedAt: 'T0', ...over,
});

function Harness({ entity = items[0], list = items, initial = emptyBible(), onShowConflict, onOpenSource, onOpenEntity, chatOf = () => undefined }: {
  entity?: TreeItem; list?: TreeItem[]; initial?: Bible; onOpenEntity?(id: string): void; onShowConflict?(k: string): void; onOpenSource?(s: unknown): void;
  chatOf?: ChatOf;
}) {
  const [bible, setBible] = useState(initial);
  return (
    <EntityPanel
      entity={entity}
      items={list}
      bible={bible}
      bodyOf={() => 'her green eyes'}
      chatOf={chatOf}
      updateBible={(u) => setBible(u)}
      onShowConflict={onShowConflict}
      onOpenEntity={onOpenEntity}
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
  it('renames a kept attribute through onRenameAttribute', () => {
    const onRenameAttribute = vi.fn();
    const initial: Bible = { ...emptyBible(), facts: [proposed({ status: 'kept' })] };
    render(
      <EntityPanel
        entity={items[0]} items={items} bible={initial} bodyOf={() => ''} chatOf={() => undefined}
        updateBible={() => {}} onOpenSource={() => {}} onRenameAttribute={onRenameAttribute}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Rename Eyes' }));
    fireEvent.change(screen.getByLabelText('New name'), { target: { value: 'Eye colour' } });
    fireEvent.click(screen.getByRole('button', { name: 'Rename' }));
    expect(onRenameAttribute).toHaveBeenCalledWith('e1', 'Eyes', 'Eye colour', false);
    expect(screen.queryByLabelText('New name')).toBeNull();
  });

  it('offers no rename without onRenameAttribute', () => {
    render(<Harness initial={{ ...emptyBible(), facts: [proposed({ status: 'kept' })] }} />);
    expect(screen.queryByRole('button', { name: 'Rename Eyes' })).toBeNull();
  });

  const keptAge = (id: string, age: number, year: number): Fact =>
    proposed({ id, attribute: 'age', value: { age, year }, status: 'kept', source: undefined });

  it('shows the implied age at the start', () => {
    render(<Harness initial={{ ...emptyBible(), facts: [keptAge('a1', 6, 0), keptAge('a2', 18, 12)] }} />);
    expect(screen.getByText('Age: 6 at the start')).toBeInTheDocument();
  });

  it('shows a birth after the start as a year', () => {
    render(<Harness initial={{ ...emptyBible(), facts: [keptAge('a1', 3, 10)] }} />);
    expect(screen.getByText('Age: born in year 7')).toBeInTheDocument();
  });

  it('shows no age line while kept ages conflict', () => {
    render(<Harness initial={{ ...emptyBible(), facts: [keptAge('a1', 6, 0), keptAge('a2', 9, 0)] }} />);
    expect(screen.queryByText(/^Age: /)).toBeNull();
  });

  it('says the message was deleted for a source citing a removed AI chat message', () => {
    const chat = { version: 1, settings: {}, messages: [] } as unknown as ChatTranscript;
    const initial: Bible = { ...emptyBible(), facts: [proposed({ source: { itemId: 'chat', messageId: 'gone', quote: 'her green eyes', start: 0, end: 14 } })] };
    render(<Harness initial={initial} chatOf={() => chat} />);
    expect(screen.getByText('message was deleted')).toBeInTheDocument();
    expect(screen.queryByText('passage no longer found')).toBeNull();
  });

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

  describe('events and backlinks', () => {
    const ref = (targetId: string) => ({ id: `r-${targetId}`, targetId });
    const when = (id: string, entityId: string, season: number, episode?: number): Fact => ({
      id, entityId, attribute: 'when', value: { season, episode }, status: 'kept', origin: 'manual', createdAt: 'T0', updatedAt: 'T0',
    });
    const ent = (id: string, kind: string, title: string, order: number, references?: { id: string; targetId: string }[]): TreeItem =>
      ({ id, parentId: null, type: 'entity', entityKind: kind, title, order, keywords: [], references });
    const list: TreeItem[] = [
      ent('mara', 'character', 'Mara', 0),
      ent('plot', 'plotline', 'Rebellion', 1),
      ent('A', 'event', 'Coup', 2, [ref('mara'), ref('plot')]),
      ent('B', 'event', 'Trial', 3, [ref('mara'), ref('plot')]),
      ent('C', 'event', 'Prologue', 4, [ref('plot')]),
    ];
    const facts = [when('wa', 'A', 3, 4), when('wb', 'B', 3, 2), when('wc', 'C', 1, 1)];
    const deps = [{ id: 'd1', eventId: 'B', afterEventId: 'A' }];
    const bible: Bible = { ...emptyBible(), facts, dependencies: deps };

    it('shows a violated check line naming the earlier event', () => {
      render(<Harness entity={list[3]} list={list} initial={bible} />);
      const sec = screen.getByRole('region', { name: 'Must come after' });
      expect(within(sec).getByText('Coup')).toBeInTheDocument();
      expect(within(sec).getByLabelText('violated')).toBeInTheDocument();
      expect(screen.getByRole('region', { name: 'When' })).toHaveTextContent('S3 · E2');
    });

    it('shows unknown with no kept position, and a cycle warning', () => {
      const cyc: Bible = { ...emptyBible(), dependencies: [...deps, { id: 'd2', eventId: 'A', afterEventId: 'B' }] };
      render(<Harness entity={list[3]} list={list} initial={cyc} />);
      expect(screen.getByLabelText('unknown')).toBeInTheDocument();
      expect(screen.getByText(/circular/i)).toBeInTheDocument();
    });

    it('adds and removes a dependency', () => {
      render(<Harness entity={list[4]} list={list} initial={bible} />);
      const sec = screen.getByRole('region', { name: 'Must come after' });
      fireEvent.change(within(sec).getByLabelText('Add dependency'), { target: { value: 'A' } });
      expect(within(sec).getByRole('button', { name: 'Coup' })).toBeInTheDocument();
      fireEvent.click(within(sec).getByRole('button', { name: 'Remove dependency on Coup' }));
      expect(within(sec).queryByRole('button', { name: 'Remove dependency on Coup' })).toBeNull();
    });

    it('lists participants and plotline of an event and opens them', () => {
      const onOpenEntity = vi.fn();
      render(<Harness entity={list[2]} list={list} initial={bible} onOpenEntity={onOpenEntity} />);
      fireEvent.click(within(screen.getByRole('region', { name: 'Participants' })).getByRole('button', { name: 'Mara' }));
      expect(onOpenEntity).toHaveBeenCalledWith('mara');
      expect(within(screen.getByRole('region', { name: 'Plotline' })).getByText('Rebellion')).toBeInTheDocument();
    });

    it('lists the events that reference a character', () => {
      render(<Harness entity={list[0]} list={list} initial={bible} />);
      const sec = screen.getByRole('region', { name: 'Events' });
      expect(within(sec).getByText('Coup')).toBeInTheDocument();
      expect(within(sec).getByText('Trial')).toBeInTheDocument();
      expect(within(sec).queryByText('Prologue')).toBeNull();
    });

    it('lists a plotline events in season order', () => {
      render(<Harness entity={list[1]} list={list} initial={bible} />);
      const names = within(screen.getByRole('region', { name: 'Events' })).getAllByRole('button').map(b => b.textContent);
      expect(names).toEqual(['Prologue', 'Trial', 'Coup']);
    });
  });
});
