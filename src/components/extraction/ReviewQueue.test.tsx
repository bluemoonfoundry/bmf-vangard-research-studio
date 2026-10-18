import { describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import type { Evidence, Fact, TreeItem } from '@/project/types';
import { emptyBible } from '@/bible/normalize';
import { emptyExtraction, type Canon, type PendingProposal } from '@/extraction/types';
import { ReviewQueue } from '@/components/extraction/ReviewQueue';

const ent = (id: string, title: string, parentId: string | null = null): TreeItem => ({ id, parentId, type: 'entity', entityKind: 'character', title, order: 0, keywords: [] });
const folder = (id: string, title: string): TreeItem => ({ id, parentId: null, type: 'folder', title, order: 0, keywords: [] });
const chat: TreeItem = { id: 's1', parentId: null, type: 'chat', title: 'Harbour chat', order: 0, keywords: [] };
const ev = (start: number, strength: Evidence['strength'] = 'said', itemId = 's1'): Evidence => ({ source: { itemId, quote: 'Mara has green eyes.', start, end: start + 20 }, strength });
const aiFact: Fact = {
  id: 'f1', entityId: 'e1', attribute: 'eyes', value: 'green', status: 'proposed', origin: 'ai',
  source: ev(0).source, evidence: [ev(0, 'built_on'), ev(0, 'built_on', 's2')], createdAt: 'T', updatedAt: 'T',
};
const suggestion: PendingProposal = { id: 'p1', ref: { entityId: 'e1' }, attribute: 'past', value: 'smuggler', strength: 'suggested', evidence: [ev(30, 'suggested')], createdAt: 'T' };
const cardProposal: PendingProposal = { id: 'p2', ref: { cardId: 'c1' }, attribute: 'role', value: 'pilot', strength: 'said', evidence: [ev(60)], createdAt: 'T' };
const card = { id: 'c1', kind: 'character' as const, title: 'Ivo', reason: 'Mara\'s brother, mentioned often', createdAt: 'T' };

function setup(initial: Canon, items: TreeItem[] = [folder('people', 'People'), ent('e1', 'Mara', 'people'), chat]) {
  const box = { canon: initial };
  const addEntity = vi.fn(() => 'e9');
  const onOpenCard = vi.fn();
  function Host() {
    const [canon, setCanon] = useState(initial);
    box.canon = canon;
    return (
      <ReviewQueue
        items={items}
        bible={canon.bible}
        extraction={canon.extraction}
        bodyOf={() => 'Mara has green eyes.'.padEnd(100, ' ')}
        chatOf={() => undefined}
        updateCanon={(fn) => setCanon(c => fn(c))}
        addEntity={addEntity}
        onOpenSource={vi.fn()}
        onOpenCard={onOpenCard}
      />
    );
  }
  render(<Host />);
  return { box, addEntity, onOpenCard };
}

const canonOf = (facts: Fact[] = [], x: Partial<Canon['extraction']> = {}): Canon =>
  ({ bible: { ...emptyBible(), facts }, extraction: { ...emptyExtraction(), ...x } });

describe('ReviewQueue', () => {
  it('says when there is nothing to review', () => {
    setup(canonOf());
    expect(screen.getByText('Nothing to review.')).toBeInTheDocument();
  });

  it('shows an entity\'s proposed facts with their evidence label and keeps one', () => {
    const { box, onOpenCard } = setup(canonOf([aiFact]));
    const group = screen.getByRole('region', { name: 'Mara' });
    expect(within(group).getByText('Built on')).toBeInTheDocument();
    expect(within(group).getByText('2 sources')).toBeInTheDocument();
    fireEvent.click(within(group).getByRole('button', { name: 'Keep' }));
    expect(box.canon.bible.facts[0].status).toBe('kept');
    expect(screen.getByText('Nothing to review.')).toBeInTheDocument();
    expect(onOpenCard).not.toHaveBeenCalled();
  });

  it('setting aside a proposed fact is a rejection', () => {
    const { box } = setup(canonOf([aiFact]));
    fireEvent.click(screen.getByRole('button', { name: 'Set aside' }));
    expect(box.canon.bible.facts[0].status).toBe('set_aside');
  });

  it('approves a new card into the chosen folder, moving its facts into review', () => {
    const { box, addEntity } = setup(canonOf([], { cards: [card], pending: [cardProposal] }));
    const group = screen.getByRole('region', { name: 'New card: Ivo' });
    expect(within(group).getByText(card.reason)).toBeInTheDocument();
    expect(within(group).getByRole('combobox', { name: 'Folder for Ivo' })).toHaveValue('people');
    fireEvent.click(within(group).getByRole('button', { name: 'Approve' }));
    expect(addEntity).toHaveBeenCalledWith('character', 'Ivo', 'people');
    expect(box.canon.extraction.cards).toEqual([]);
    expect(box.canon.bible.facts).toMatchObject([{ entityId: 'e9', attribute: 'role', value: 'pilot', status: 'proposed' }]);
  });

  it('rejects a new card', () => {
    const { box } = setup(canonOf([], { cards: [card], pending: [cardProposal] }));
    fireEvent.click(screen.getByRole('button', { name: 'Reject' }));
    expect(box.canon.extraction.cards).toEqual([]);
    expect(box.canon.extraction.pending).toEqual([]);
    expect(box.canon.extraction.rejections).toHaveLength(1);
  });

  it('keeps suggestions in a collapsed pile, to promote or dismiss', () => {
    const { box } = setup(canonOf([], { pending: [suggestion, { ...suggestion, id: 'p3', value: 'pirate' }] }));
    const pile = screen.getByText('Only suggested (2)').closest('details')!;
    expect(pile).not.toHaveAttribute('open');
    fireEvent.click(within(pile).getAllByRole('button', { name: 'Promote' })[0]);
    expect(box.canon.bible.facts).toMatchObject([{ attribute: 'past', value: 'smuggler', status: 'proposed' }]);
    fireEvent.click(within(pile).getByRole('button', { name: 'Dismiss' }));
    expect(box.canon.extraction.pending).toEqual([]);
    expect(box.canon.extraction.rejections.map(r => r.label)).toEqual(['past: pirate']);
  });
});
