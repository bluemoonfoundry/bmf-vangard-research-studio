import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import type { Bible, Fact, StoryPosition, TreeItem } from '@/project/types';
import { emptyBible } from '@/bible/normalize';
import { ConflictQueue } from '@/components/bible/ConflictQueue';
import { EntityPanel } from '@/components/bible/EntityPanel';
import type { ChatOf, ChatTranscript } from '@/chat/types';

const ent = (id: string, title: string, entityKind: string): TreeItem =>
  ({ id, parentId: null, type: 'entity', entityKind, title, order: 0, keywords: [] }) as TreeItem;

const items: TreeItem[] = [
  ent('e1', 'Mara', 'character'), ent('e2', 'Ren', 'character'),
  ent('mira', 'Mira falls', 'event'), ent('hal', 'Hal arrives', 'event'), ent('ren', 'Ren leaves', 'event'),
  { id: 'chat', parentId: null, type: 'chat', title: 'Session 1', order: 9, keywords: [] },
];

let n = 0;
const fact = (entityId: string, attribute: string, value: string | StoryPosition, over: Partial<Fact> = {}): Fact => ({
  id: `f${++n}`, entityId, attribute, value, status: 'kept', origin: 'manual', createdAt: 'T0', updatedAt: 'T0', ...over,
});

function Harness({ initial, focusKey, onOpenSource, showEntity, chatOf = () => undefined }: {
  initial: Bible; focusKey?: string; onOpenSource?(s: unknown): void; showEntity?: boolean; chatOf?: ChatOf;
}) {
  const [bible, setBible] = useState(initial);
  return (
    <>
      <ConflictQueue
        bible={bible}
        items={items}
        contentOf={() => 'body'}
        chatOf={chatOf}
        focusKey={focusKey}
        onUpdate={(u) => setBible(u)}
        onOpenSource={(onOpenSource ?? (() => undefined)) as never}
        onOpenEntity={() => undefined}
        sourceOrder={['old', 'new']}
      />
      {showEntity && (
        <EntityPanel entity={items[0]} items={items} bible={bible} bodyOf={() => 'body'} chatOf={() => undefined} updateBible={(u) => setBible(u)} onOpenSource={() => undefined} />
      )}
    </>
  );
}

const death = (): Bible => ({
  ...emptyBible(),
  facts: [fact('e1', 'death', 'Season 3 finale', { id: 'a' }), fact('e1', 'death', 'Pilot', { id: 'b' })],
});
const cards = () => screen.getAllByRole('article');

describe('ConflictQueue', () => {
  it('lists the open contradiction with one card per version', () => {
    render(<Harness initial={death()} />);
    expect(within(screen.getByRole('complementary', { name: 'Contradictions' })).getByText('Mara · death')).toBeInTheDocument();
    expect(screen.getByText('2 versions')).toBeInTheDocument();
    expect(cards()).toHaveLength(2);
  });

  it('keeps one, lists it as decided, and reopens it', () => {
    render(<Harness initial={death()} />);
    fireEvent.click(within(cards()[0]).getByRole('button', { name: 'Keep this one' }));
    expect(screen.getByText('No open contradictions')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Decided' }));
    expect(screen.getByText('Mara · death')).toBeInTheDocument();
    expect(screen.getByText('Kept one')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Reopen' }));
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    expect(within(screen.getByRole('complementary', { name: 'Contradictions' })).getByText('Mara · death')).toBeInTheDocument();
    expect(cards()).toHaveLength(2);
  });

  it('keeps both with a note and the entity page says so', () => {
    render(<Harness initial={death()} showEntity />);
    fireEvent.change(screen.getByLabelText('Note'), { target: { value: 'branch' } });
    fireEvent.click(screen.getByRole('button', { name: 'Keep both' }));
    expect(screen.getByText('No open contradictions')).toBeInTheDocument();
    expect(screen.getByText(/multiple versions kept: branch/)).toBeInTheDocument();
  });

  it('labels a two-version decision with corroborating facts as "Kept both"', () => {
    const bible: Bible = { ...emptyBible(), facts: [fact('e1', 'death', 'Pilot'), fact('e1', 'death', 'pilot'), fact('e1', 'death', 'Finale')] };
    render(<Harness initial={bible} />);
    fireEvent.click(screen.getByRole('button', { name: 'Keep both' }));
    fireEvent.click(screen.getByRole('button', { name: 'Decided' }));
    expect(screen.getByText('Kept both')).toBeInTheDocument();
  });

  it('moves to the next open contradiction after a decision', () => {
    const bible: Bible = { ...death(), facts: [...death().facts, fact('e2', 'eyes', 'green'), fact('e2', 'eyes', 'blue')] };
    render(<Harness initial={bible} />);
    fireEvent.click(within(cards()[0]).getByRole('button', { name: 'Keep this one' }));
    expect(screen.getByRole('heading', { name: 'Ren · eyes' })).toBeInTheDocument();
  });

  it('focuses the contradiction named by focusKey', () => {
    const bible: Bible = { ...death(), facts: [...death().facts, fact('e2', 'eyes', 'green'), fact('e2', 'eyes', 'blue')] };
    render(<Harness initial={bible} focusKey={'e2\u0000eyes'} />);
    expect(screen.getByRole('heading', { name: 'Ren · eyes' })).toBeInTheDocument();
  });

  it('says the message was deleted for a version citing a removed AI chat message', () => {
    const chat = { version: 1, settings: {}, messages: [] } as unknown as ChatTranscript;
    const source = { itemId: 'chat', messageId: 'gone', quote: 'she died', start: 0, end: 8 };
    const bible: Bible = { ...emptyBible(), facts: [fact('e1', 'death', 'A', { source }), fact('e1', 'death', 'B')] };
    render(<Harness initial={bible} chatOf={() => chat} />);
    expect(within(cards()[0]).getByText('message was deleted')).toBeInTheDocument();
  });

  it('opens a version source', () => {
    const source = { itemId: 'chat', quote: 'she died', start: 0, end: 8 };
    const bible: Bible = { ...emptyBible(), facts: [fact('e1', 'death', 'A', { source }), fact('e1', 'death', 'B')] };
    const onOpenSource = vi.fn();
    render(<Harness initial={bible} onOpenSource={onOpenSource} />);
    fireEvent.click(screen.getByRole('button', { name: 'Session 1' }));
    expect(onOpenSource).toHaveBeenCalledWith(source);
  });

  it('shows ordering checks on the violating version only (Mira scenario)', () => {
    const bible: Bible = {
      facts: [
        fact('hal', 'when', { season: 3, episode: 4 }), fact('ren', 'when', { season: 4, episode: 1 }),
        fact('mira', 'when', { season: 3, episode: 10 }), fact('mira', 'when', { season: 5, episode: 2 }, { status: 'proposed' }),
      ],
      dependencies: [{ id: 'd1', eventId: 'mira', afterEventId: 'hal' }, { id: 'd2', eventId: 'ren', afterEventId: 'mira' }],
      decisions: [],
    };
    render(<Harness initial={bible} />);
    const [s3, s5] = cards();
    expect(within(s3).getByText('S3 · E10')).toBeInTheDocument();
    expect(within(s3).queryByText(/✗/)).toBeNull();
    expect(within(s3).getAllByText(/✓/)).toHaveLength(2);
    expect(within(s5).getByText('S5 · E2')).toBeInTheDocument();
    expect(within(s5).getByText(/✗ must come before Ren leaves/)).toBeInTheDocument();
    expect(within(s5).getByText(/✓ after Hal arrives/)).toBeInTheDocument();
  });

  it('shows no ordering checks for a non-event', () => {
    const bible: Bible = {
      ...emptyBible(),
      facts: [fact('e1', 'when', { season: 1 }), fact('e1', 'when', { season: 2 })],
      dependencies: [{ id: 'd', eventId: 'e1', afterEventId: 'hal' }],
    };
    render(<Harness initial={bible} />);
    expect(screen.queryByText(/after Hal/)).toBeNull();
  });
});

describe('ConflictQueue: keep the newer', () => {
  const src = (itemId: string) => ({ itemId, quote: 'q', start: 0, end: 1 });

  it('keeps the version from the source further down the order', () => {
    const initial = { ...emptyBible(), facts: [fact('e1', 'Eyes', 'green', { source: src('new') }), fact('e1', 'Eyes', 'brown', { source: src('old') })] };
    render(<Harness initial={initial} />);
    fireEvent.click(screen.getByRole('button', { name: 'Keep the newer' }));
    expect(screen.getByText('No open contradictions')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Decided' }));
    expect(screen.getByText('Kept one')).toBeInTheDocument();
  });

  it('is not offered when both versions come from one source', () => {
    const initial = { ...emptyBible(), facts: [fact('e1', 'Eyes', 'green', { source: src('new') }), fact('e1', 'Eyes', 'brown', { source: src('new') })] };
    render(<Harness initial={initial} />);
    expect(screen.queryByRole('button', { name: 'Keep the newer' })).toBeNull();
  });
});
