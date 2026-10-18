import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { TextImportBatch } from '@/project/types';
import { normalizeChatText } from '@/bible/entities';
import { ImportChatModal, type ImportChatModalProps } from '@/components/bible/ImportChatModal';
import raw from '@/chat/fixtures/aistudio-exporter-sample.md?raw';

const sample = normalizeChatText(raw);

function setup(over: Partial<ImportChatModalProps> = {}) {
  const props: ImportChatModalProps = {
    importTexts: vi.fn(async () => null),
    sources: [{ id: 's1', title: 'Old chat' }, { id: 's2', title: 'Newer chat' }],
    onImport: vi.fn(),
    onClose: vi.fn(),
    ...over,
  };
  render(<ImportChatModal {...props} />);
  return { props, dialog: screen.getByRole('dialog', { name: 'Import chat' }) };
}

describe('ImportChatModal', () => {
  it('recognises a pasted AI Studio export and imports it in the canonical layout as newest', () => {
    const { props, dialog } = setup();
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Chat text' }), { target: { value: sample } });
    expect(within(dialog).getByText('AI Studio export · 3 turns')).toBeInTheDocument();
    expect(within(dialog).getByRole('textbox', { name: 'Title' })).toHaveValue('Sky Harbour Test Chat');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Import' }));
    const [entries, position] = vi.mocked(props.onImport).mock.calls[0];
    expect(position).toBe(2);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      title: 'Sky Harbour Test Chat', importedFormat: 'aistudio-exporter-md', sourceUrl: 'https://aistudio.google.com/prompts/abc123',
    });
    expect(entries[0].body.startsWith('=== You ===\n\n')).toBe(true);
  });

  it('imports pasted plain text unchanged', () => {
    const { props, dialog } = setup();
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Chat text' }), { target: { value: 'You: hi\r\nAI: hello' } });
    expect(within(dialog).getByText('Plain text')).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Import' }));
    expect(vi.mocked(props.onImport).mock.calls[0][0][0]).toMatchObject({ title: 'Imported chat', body: 'You: hi\nAI: hello', importedFormat: 'text' });
  });

  it('lists picked files with their formats and skipped files, and imports them in the chosen order', async () => {
    const batch: TextImportBatch = {
      imports: [
        { title: 'export', text: sample, fileName: 'export.md' },
        { title: 'notes', text: 'plain', fileName: 'notes' },
      ],
      skipped: [{ fileName: 'pic.png', message: 'pic.png is not a supported text file.' }],
    };
    const { props, dialog } = setup({ importTexts: vi.fn(async () => batch) });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Choose files…' }));
    expect(await within(dialog).findByRole('textbox', { name: 'Title for export.md' })).toHaveValue('Sky Harbour Test Chat');
    expect(within(dialog).getByRole('textbox', { name: 'Title for notes' })).toHaveValue('notes');
    expect(within(dialog).getByText('pic.png: pic.png is not a supported text file.')).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Move notes up' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Import' }));
    const [entries] = vi.mocked(props.onImport).mock.calls[0];
    expect(entries.map(e => e.title)).toEqual(['notes', 'Sky Harbour Test Chat']);
    expect(entries[0]).toMatchObject({ importedFrom: 'notes', importedFormat: 'text', body: 'plain' });
  });

  it('places the batch where the writer chooses', () => {
    const { props, dialog } = setup();
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Chat text' }), { target: { value: 'x' } });
    const place = within(dialog).getByRole('combobox', { name: 'Place' });
    expect(place).toHaveValue('2');
    fireEvent.change(place, { target: { value: '0' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Import' }));
    expect(vi.mocked(props.onImport).mock.calls[0][1]).toBe(0);
  });

  it('hides placement when there are no other sources', async () => {
    const { dialog } = setup({ sources: [] });
    await waitFor(() => expect(within(dialog).queryByRole('combobox', { name: 'Place' })).toBeNull());
  });
});
