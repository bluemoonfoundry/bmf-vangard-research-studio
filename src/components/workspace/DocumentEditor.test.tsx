import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { TreeItem } from '@/project/types';
import { DocumentEditor } from '@/components/workspace/DocumentEditor';

const item: TreeItem = { id: 'd', parentId: null, type: 'document', title: 'Notes', order: 0, keywords: [] };
const TEXT = 'Line one.\nMira dies here.\nEnd.';

const props = {
  item, content: TEXT, breadcrumbs: [{ id: null, title: 'P' }], assets: null,
  onNavigate: vi.fn(), onChangeContent: vi.fn(), onUpdate: vi.fn(), onAttachMedia: vi.fn(), onOpenLink: vi.fn(),
};

describe('DocumentEditor highlight', () => {
  it('selects the passage in the text box', () => {
    render(<DocumentEditor {...props} highlight={{ start: 10, end: 19 }} />);
    const ta = screen.getByLabelText('Document text') as HTMLTextAreaElement;
    expect(ta.selectionStart).toBe(10);
    expect(ta.selectionEnd).toBe(19);
    expect(ta.value.slice(10, 19)).toBe('Mira dies');
  });

  it('leaves the preview to show the passage', () => {
    const { rerender } = render(<DocumentEditor {...props} />);
    fireEvent.click(screen.getByRole('button', { name: /Preview/ }));
    expect(screen.queryByLabelText('Document text')).toBeNull();
    rerender(<DocumentEditor {...props} highlight={{ start: 10, end: 19 }} />);
    const ta = screen.getByLabelText('Document text') as HTMLTextAreaElement;
    expect(ta.selectionStart).toBe(10);
    expect(ta.selectionEnd).toBe(19);
  });
});
