import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import type { Bible, Fact, StoryPosition, TreeItem } from '@/project/types';
import { emptyBible } from '@/bible/normalize';
import { contradictionKey } from '@/bible/contradictions';
import { TimelineView } from '@/components/bible/TimelineView';

const ev = (id: string, title: string): TreeItem =>
  ({ id, parentId: null, type: 'entity', entityKind: 'event', title, order: 0, keywords: [] }) as TreeItem;

let n = 0;
const when = (entityId: string, value: StoryPosition, status: Fact['status'] = 'kept'): Fact => ({
  id: `f${++n}`, entityId, attribute: 'when', value, status, origin: 'manual', createdAt: 'T0', updatedAt: 'T0',
});

const items = [ev('a', 'Alpha'), ev('b', 'Bravo'), ev('c', 'Charlie'), ev('d', 'Delta'), ev('u', 'Unset')];
const bible: Bible = {
  ...emptyBible(),
  facts: [
    when('a', { season: 4, episode: 1 }),
    when('b', { season: 3, episode: 4 }),
    when('c', { season: 3 }),
    when('d', { season: 1, episode: 1 }), when('d', { season: 2, episode: 2 }),
  ],
};

const setup = (b = bible, its = items) => {
  const onOpenEntity = vi.fn();
  const onShowConflict = vi.fn();
  render(<TimelineView bible={b} items={its} onOpenEntity={onOpenEntity} onShowConflict={onShowConflict} />);
  return { onOpenEntity, onShowConflict };
};

describe('TimelineView', () => {
  it('groups placed events under season headings in order', () => {
    setup({ ...bible, facts: bible.facts.slice(0, 3) }, items.slice(0, 3));
    const headings = screen.getAllByRole('heading', { level: 3 }).map(h => h.textContent);
    expect(headings).toEqual(['Season 3', 'Season 4']);
    const rows = screen.getAllByRole('button').map(b => b.textContent ?? '');
    expect(rows[0]).toContain('Charlie');
    expect(rows[1]).toContain('Bravo');
    expect(rows[2]).toContain('Alpha');
  });

  it('shows contested events only in Timing contested and links to the conflict', () => {
    const { onShowConflict } = setup();
    const section = screen.getByRole('region', { name: 'Timing contested' });
    expect(within(section).getByText('Delta')).toBeTruthy();
    expect(screen.getAllByText('Delta')).toHaveLength(1);
    fireEvent.click(within(section).getByRole('button', { name: /Delta/ }));
    expect(onShowConflict).toHaveBeenCalledWith(contradictionKey('d', 'when'));
  });

  it('lists events with no position under Unplaced', () => {
    setup();
    const section = screen.getByRole('region', { name: 'Unplaced' });
    expect(within(section).getByText('Unset')).toBeTruthy();
  });

  it('shows version n of m when an event has several kept positions', () => {
    const facts = [when('a', { season: 1, episode: 1 }), when('a', { season: 2, episode: 2 })];
    const b: Bible = {
      ...emptyBible(), facts,
      decisions: [{ id: 'dec', entityId: 'a', attribute: 'when', kind: 'kept_all', factIds: facts.map(f => f.id), setAsideIds: [], at: 'T0' }],
    };
    setup(b, [ev('a', 'Alpha')]);
    expect(screen.getByText(/version 1 of 2/)).toBeTruthy();
    expect(screen.getByText(/version 2 of 2/)).toBeTruthy();
  });

  it('calls onOpenEntity when a row is clicked', () => {
    const { onOpenEntity } = setup();
    fireEvent.click(screen.getByRole('button', { name: /Alpha/ }));
    expect(onOpenEntity).toHaveBeenCalledWith('a');
  });

  it('shows an empty state when there are no events', () => {
    setup(emptyBible(), []);
    expect(screen.getByText('No events yet. Add an Entity of kind Event to build the timeline.')).toBeTruthy();
  });
});
