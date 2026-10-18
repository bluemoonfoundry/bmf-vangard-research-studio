import { useState } from 'react';
import { ArrowDown, ArrowUp } from 'lucide-react';
import { Modal } from '@/components/workspace/Modal';
import { btn, btnGhost, btnPrimary } from '@/components/workspace/ui';

export interface SourceOrderModalProps {
  /** Oldest first. */
  sources: { id: string; title: string; detail?: string }[];
  onSave(ids: string[]): void;
  onClose(): void;
}

/** Reorders the project's sources (chats, AI chats, documents). Mount fresh for each use. */
export function SourceOrderModal({ sources, onSave, onClose }: SourceOrderModalProps) {
  const [rows, setRows] = useState(sources);

  const move = (from: number, to: number) => setRows(r => {
    const next = [...r];
    [next[from], next[to]] = [next[to], next[from]];
    return next;
  });

  return (
    <Modal
      title="Source order"
      onClose={onClose}
      footer={(
        <>
          <button type="button" className={btn} onClick={onClose}>Cancel</button>
          <button type="button" className={btnPrimary} onClick={() => { onSave(rows.map(r => r.id)); onClose(); }}>Save</button>
        </>
      )}
    >
      <div className="flex flex-col gap-3 text-xs">
        <p className="text-content-muted">Oldest at the top. When two sources disagree, VRS suggests keeping the newer one.</p>
        {rows.length === 0 ? (
          <p className="text-content-muted">No chats or documents yet.</p>
        ) : (
          <ol className="flex flex-col divide-y divide-line rounded border border-line">
            {rows.map((r, i) => (
              <li key={r.id} className="flex items-center gap-2 px-2 py-1">
                <span className="w-5 text-right text-content-muted">{i + 1}</span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate">{r.title || 'Untitled'}</span>
                  {r.detail && <span className="truncate text-content-muted">{r.detail}</span>}
                </span>
                <button type="button" className={btnGhost} aria-label={`Move ${i + 1}. ${r.title || 'Untitled'} up`} disabled={i === 0} onClick={() => move(i, i - 1)}>
                  <ArrowUp className="h-3.5 w-3.5" />
                </button>
                <button type="button" className={btnGhost} aria-label={`Move ${i + 1}. ${r.title || 'Untitled'} down`} disabled={i === rows.length - 1} onClick={() => move(i, i + 1)}>
                  <ArrowDown className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
          </ol>
        )}
      </div>
    </Modal>
  );
}
