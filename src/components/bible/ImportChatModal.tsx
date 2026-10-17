import { useState } from 'react';
import { Upload } from 'lucide-react';
import type { TextImport } from '@/project/types';
import { Modal } from '@/components/workspace/Modal';
import { btn, btnPrimary, fieldLabel, input } from '@/components/workspace/ui';

export interface ImportChatModalProps {
  importText(): Promise<TextImport | null>;
  onCreate(fields: { title: string; importedFrom?: string }, text: string): void;
  onClose(): void;
}

/** Imports a chat transcript by paste or from a text file. Mount fresh for each use. */
export function ImportChatModal({ importText, onCreate, onClose }: ImportChatModalProps) {
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [fileName, setFileName] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);

  const chooseFile = async () => {
    setPicking(true);
    try {
      const picked = await importText();
      if (!picked) return;
      setText(picked.text);
      setTitle(picked.title);
      setFileName(picked.fileName);
    } finally {
      setPicking(false);
    }
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    const fields: { title: string; importedFrom?: string } = { title: title.trim() || 'Imported chat' };
    if (fileName) fields.importedFrom = fileName;
    onCreate(fields, text);
    onClose();
  };

  return (
    <Modal
      title="Import chat"
      onClose={onClose}
      footer={(
        <>
          <button type="button" className={btn} onClick={onClose}>Cancel</button>
          <button type="submit" form="import-chat-form" className={btnPrimary} disabled={!text.trim() || picking}>Import</button>
        </>
      )}
    >
      <form id="import-chat-form" onSubmit={submit} className="flex flex-col gap-4 text-xs">
        <label className="flex flex-col gap-1">
          <span className={fieldLabel}>Title</span>
          <input className={input} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Imported chat" />
        </label>
        <label className="flex flex-col gap-1">
          <span className={fieldLabel}>Chat text</span>
          <textarea data-autofocus className={`${input} resize-none font-mono`} rows={10} value={text} onChange={(e) => { setText(e.target.value); setFileName(null); }} placeholder="Paste a chat transcript…" />
        </label>
        <div className="flex items-center justify-between gap-3 text-content-muted">
          <span className="truncate">{fileName ?? 'Or load a text file'}</span>
          <button type="button" className={btn} onClick={() => void chooseFile()} disabled={picking}>
            <Upload className="h-3.5 w-3.5" /> From file…
          </button>
        </div>
      </form>
    </Modal>
  );
}
