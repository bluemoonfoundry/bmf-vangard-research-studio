import { useState } from 'react';
import { AlertTriangle, Paperclip, X } from 'lucide-react';
import type { TreeItem } from '@/project/types';
import { ancestorsOf } from '@/workspace/treeOps';
import { ItemIcon } from '@/components/workspace/ItemIcon';
import { BINDER_DRAG_TYPE } from '@/components/workspace/Binder';
import { btn, btnGhost, input } from '@/components/workspace/ui';

interface AttachmentsPanelProps {
  /** The chat's own id: a chat can't attach itself. */
  chatId: string;
  attachments: string[];
  items: TreeItem[];
  onChange(attachments: string[]): void;
}

const pathTitle = (items: TreeItem[], item: TreeItem) =>
  [...ancestorsOf(items, item.id), item].map(a => a.title || 'Untitled').join(' › ');

/**
 * Binder items attached to the chat's context. A folder means every document under it. Removing an attachment
 * never touches the item; an attachment whose item was deleted shows as missing (and is skipped when sending).
 */
export function AttachmentsPanel({ chatId, attachments, items, onChange }: AttachmentsPanelProps) {
  const [picked, setPicked] = useState('');
  const [dropping, setDropping] = useState(false);
  const byId = new Map(items.map(i => [i.id, i]));
  const choices = items.filter(i => i.type !== 'entity' && i.id !== chatId && !attachments.includes(i.id));

  const attach = (id: string) => {
    const item = byId.get(id);
    if (!item || item.type === 'entity' || id === chatId || attachments.includes(id)) return;
    onChange([...attachments, id]);
  };

  return (
    <section
      aria-label="Attachments"
      className={`flex flex-col gap-2 border-b border-line bg-surface-raised px-4 py-3 text-xs ${dropping ? 'ring-2 ring-inset ring-accent' : ''}`}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes(BINDER_DRAG_TYPE)) return;
        e.preventDefault();
        setDropping(true);
      }}
      onDragLeave={() => setDropping(false)}
      onDrop={(e) => {
        setDropping(false);
        const id = e.dataTransfer.getData(BINDER_DRAG_TYPE);
        if (!id) return;
        e.preventDefault();
        attach(id);
      }}
    >
      {attachments.length === 0 ? (
        <p className="text-content-muted">No attachments. Pick binder items (or drag them here) to give the chat their text.</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {attachments.map(id => {
            const item = byId.get(id);
            const title = item ? item.title || 'Untitled' : 'Missing item (deleted)';
            return (
              <li key={id} className="flex items-center gap-2 rounded border border-line bg-surface px-2 py-1">
                {item ? <ItemIcon item={item} className="h-3.5 w-3.5 text-content-muted" /> : <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-warning" aria-hidden />}
                <span className={`min-w-0 flex-1 truncate ${item ? '' : 'italic text-content-muted'}`} title={item ? pathTitle(items, item) : undefined}>
                  {title}
                </span>
                <button type="button" className={btnGhost} aria-label={`Remove ${item ? title : 'missing item'}`} onClick={() => onChange(attachments.filter(a => a !== id))}>
                  <X className="h-3 w-3" />
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <div className="flex items-center gap-2">
        <select aria-label="Attach an item" className={`${input} min-w-0 flex-1`} value={picked} onChange={(e) => setPicked(e.target.value)}>
          <option value="">Choose a binder item…</option>
          {choices.map(i => <option key={i.id} value={i.id}>{pathTitle(items, i)}</option>)}
        </select>
        <button
          type="button"
          className={btn}
          disabled={!picked}
          onClick={() => {
            attach(picked);
            setPicked('');
          }}
        >
          <Paperclip className="h-3.5 w-3.5" /> Attach
        </button>
      </div>
    </section>
  );
}
