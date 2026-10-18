import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { formatTurns } from '@/chat/importFormats';
import { ChatView } from '@/components/bible/ChatView';

const BODY = formatTurns([
  { role: 'user', label: 'You', text: 'Who runs the harbour?' },
  { role: 'model', label: 'Gemini', text: 'Odile, a retired pilot.' },
]);

const pre = () => screen.getByLabelText('Chat transcript');

/** Selects `body.slice(start, end)` in the rendered transcript, across element boundaries. */
function selectRange(start: number, end: number) {
  const walker = document.createTreeWalker(pre(), NodeFilter.SHOW_TEXT);
  const at = (offset: number): [Node, number] => {
    let seen = 0;
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const len = n.textContent!.length;
      if (offset <= seen + len) return [n, offset - seen];
      seen += len;
    }
    throw new Error('offset out of range');
  };
  const range = document.createRange();
  range.setStart(...at(start));
  walker.currentNode = pre();
  range.setEnd(...at(end));
  const sel = window.getSelection()!;
  sel.removeAllRanges();
  sel.addRange(range);
}

describe('ChatView turns', () => {
  it('labels each turn without changing the text', () => {
    render(<ChatView text={BODY} />);
    expect(pre().textContent).toBe(BODY);
    const headings = pre().querySelectorAll('[data-turn-heading]');
    expect([...headings].map(h => h.getAttribute('data-turn-heading'))).toEqual(['user', 'model']);
    expect(headings[1].textContent).toBe('=== Gemini ===');
  });

  it('keeps the text intact when a highlight crosses a heading', () => {
    const start = BODY.indexOf('Gemini');
    const end = BODY.indexOf('retired');
    render(<ChatView text={BODY} highlight={{ start, end }} />);
    expect(pre().textContent).toBe(BODY);
    const marks = pre().querySelectorAll('mark');
    expect([...marks].map(m => m.textContent).join('')).toBe(BODY.slice(start, end));
  });

  it('reports selection offsets into the stored text', () => {
    const onSelectRange = vi.fn();
    render(<ChatView text={BODY} onSelectRange={onSelectRange} />);
    const start = BODY.indexOf('Odile');
    selectRange(start, start + 'Odile, a retired pilot'.length);
    fireEvent.mouseUp(pre());
    const r = onSelectRange.mock.calls[0][0];
    expect(BODY.slice(r.start, r.end)).toBe('Odile, a retired pilot');
    expect(r.quote).toBe('Odile, a retired pilot');
  });

  it('leaves plain transcripts unlabelled', () => {
    render(<ChatView text={'You: hi\nAI: hello'} />);
    expect(pre().querySelector('[data-turn-heading]')).toBeNull();
  });
});
