import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { Bible, TreeItem } from '@/project/types';
import { emptyBible } from '@/bible/normalize';
import { resolveSource } from '@/bible/sources';
import { ChatView } from '@/components/bible/ChatView';
import { CaptureHost, type CaptureSelection } from '@/components/bible/CapturePopover';

const BODY = 'Ann: hello\nBen: Mira dies in the finale.\nAnn: no!';
const chat: TreeItem = { id: 'chat', parentId: 'folder', type: 'chat', title: 'Session', order: 0, keywords: [] };

function Harness({ onBible, addEntity }: { onBible(b: Bible): void; addEntity(kind: string, title: string, parentId: string | null): string }) {
  const [bible, setBible] = useState(emptyBible());
  const [sel, setSel] = useState<CaptureSelection | null>(null);
  onBible(bible);
  return (
    <>
      <ChatView text={BODY} onSelectRange={(r) => setSel({ ...r, anchor: r.rect })} />
      <CaptureHost
        itemId="chat" parentId="folder" items={[chat]} bible={bible} updateBible={setBible}
        addEntity={addEntity} selection={sel} onClose={() => setSel(null)}
      />
    </>
  );
}

function selectText(needle: string) {
  const node = screen.getByLabelText('Chat transcript').firstChild as Text;
  const start = BODY.indexOf(needle);
  const range = document.createRange();
  range.setStart(node, start);
  range.setEnd(node, start + needle.length);
  const sel = window.getSelection()!;
  sel.removeAllRanges();
  sel.addRange(range);
}

describe('capture by selection', () => {
  it('creates a new entity and a kept fact whose offsets slice back to the quote', () => {
    let latest = emptyBible();
    const addEntity = vi.fn(() => 'new-entity');
    render(<Harness onBible={(b) => { latest = b; }} addEntity={addEntity} />);
    selectText('Mira dies');
    fireEvent.mouseUp(screen.getByLabelText('Chat transcript'));

    fireEvent.change(screen.getByLabelText('Entity'), { target: { value: '__new__' } });
    fireEvent.change(screen.getByLabelText('New entity name'), { target: { value: 'Mira' } });
    fireEvent.change(screen.getByLabelText('New entity kind'), { target: { value: 'character' } });
    fireEvent.change(screen.getByLabelText('Attribute'), { target: { value: 'death' } });
    fireEvent.change(screen.getByLabelText('Value'), { target: { value: 'S3 finale' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save fact' }));

    expect(addEntity).toHaveBeenCalledWith('character', 'Mira', 'folder');
    expect(latest.facts).toHaveLength(1);
    const fact = latest.facts[0];
    expect(fact).toMatchObject({ entityId: 'new-entity', attribute: 'death', value: 'S3 finale', status: 'kept', origin: 'manual' });
    expect(fact.source!.quote).toBe('Mira dies');
    expect(fact.source!.itemId).toBe('chat');
    expect(BODY.slice(fact.source!.start, fact.source!.end)).toBe('Mira dies');
    expect(resolveSource(fact.source!, BODY, true).status).toBe('exact');
    expect(screen.queryByRole('button', { name: 'Save fact' })).toBeNull();
  });

  it('closes on Escape and on an outside click', () => {
    render(<Harness onBible={() => undefined} addEntity={() => 'x'} />);
    selectText('Mira dies');
    fireEvent.mouseUp(screen.getByLabelText('Chat transcript'));
    expect(screen.getByRole('button', { name: 'Save fact' })).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('button', { name: 'Save fact' })).toBeNull();

    selectText('Mira dies');
    fireEvent.mouseUp(screen.getByLabelText('Chat transcript'));
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole('button', { name: 'Save fact' })).toBeNull();
  });
});

describe('dismissing', () => {
  it('stays closed after Escape and its keyup', () => {
    render(<Harness onBible={() => undefined} addEntity={() => 'x'} />);
    selectText('Mira dies');
    fireEvent.mouseUp(screen.getByLabelText('Chat transcript'));
    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.keyUp(document, { key: 'Escape' });
    fireEvent.mouseUp(document.body);
    expect(screen.queryByRole('button', { name: 'Save fact' })).toBeNull();
  });

  it('stays closed after saving', () => {
    render(<Harness onBible={() => undefined} addEntity={() => 'x'} />);
    selectText('Mira dies');
    fireEvent.mouseUp(screen.getByLabelText('Chat transcript'));
    fireEvent.change(screen.getByLabelText('Entity'), { target: { value: '__new__' } });
    fireEvent.change(screen.getByLabelText('New entity name'), { target: { value: 'Mira' } });
    fireEvent.change(screen.getByLabelText('Attribute'), { target: { value: 'death' } });
    fireEvent.change(screen.getByLabelText('Value'), { target: { value: 'S3' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save fact' }));
    fireEvent.keyUp(document, { key: 'Enter' });
    fireEvent.mouseUp(document.body);
    expect(screen.queryByRole('button', { name: 'Save fact' })).toBeNull();
  });
});

describe('ChatView selection reporting', () => {
  it('reports offsets for a selection spanning the highlight mark', () => {
    const onSelectRange = vi.fn();
    render(<ChatView text={BODY} highlight={{ start: 22, end: 26 }} onSelectRange={onSelectRange} />);
    const pre = screen.getByLabelText('Chat transcript');
    const mark = pre.querySelector('mark')!;
    expect(mark.textContent).toBe(BODY.slice(22, 26));
    const range = document.createRange();
    range.setStart(pre.firstChild!, 16);
    range.setEnd(pre.lastChild!, 8); // 26 + 8 = offset 34 overall
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(range);
    fireEvent.mouseUp(pre);
    expect(onSelectRange).toHaveBeenCalledTimes(1);
    expect(onSelectRange).toHaveBeenCalledWith(expect.objectContaining({ start: 16, end: 34, quote: BODY.slice(16, 34) }));
  });

  it('still reports when the drag ends outside the transcript', () => {
    const onSelectRange = vi.fn();
    render(<><ChatView text={BODY} onSelectRange={onSelectRange} /><p>elsewhere</p></>);
    selectText('Mira dies');
    fireEvent.mouseUp(screen.getByText('elsewhere'));
    expect(onSelectRange).toHaveBeenCalledWith(expect.objectContaining({ start: BODY.indexOf('Mira dies'), quote: 'Mira dies' }));
  });

  it('ignores selections outside the transcript and stops listening on unmount', () => {
    const onSelectRange = vi.fn();
    const { unmount } = render(<><ChatView text={BODY} onSelectRange={onSelectRange} /><p>elsewhere</p></>);
    const range = document.createRange();
    range.selectNodeContents(screen.getByText('elsewhere'));
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(range);
    fireEvent.mouseUp(document.body);
    expect(onSelectRange).not.toHaveBeenCalled();
    selectText('hello');
    unmount();
    fireEvent.mouseUp(document.body);
    expect(onSelectRange).not.toHaveBeenCalled();
  });
});
