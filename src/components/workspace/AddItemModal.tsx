import { useState } from 'react';
import { Upload } from 'lucide-react';
import type { ImportedAsset, ItemType, LabelId, MediaKind, StatusId, TreeItem } from '@/project/types';
import type { NewItem } from '@/project/useProject';
import type { AssetCache } from '@/workspace/assetCache';
import { ENTITY_KINDS } from '@/bible/entities';
import { ITEM_TYPES, LABEL_LIST, STATUS_LIST } from '@/workspace/research';
import { ancestorsOf, isFolder } from '@/workspace/treeOps';
import { useAssetUrl } from '@/workspace/useAssetUrl';
import { ItemIcon } from '@/components/workspace/ItemIcon';
import { Modal } from '@/components/workspace/Modal';
import { btn, btnPrimary, fieldLabel, input } from '@/components/workspace/ui';

export interface AddItemModalProps {
  initialType: ItemType;
  initialParentId: string | null;
  items: TreeItem[];
  assets: AssetCache | null;
  importMedia(kind: MediaKind): Promise<ImportedAsset | null>;
  /** An imported file the user didn't keep (cancelled, or picked another). */
  discardAsset(asset: string): void;
  onCreate(fields: NewItem, content: string): void;
  onClose(): void;
}

const mediaKindOf = (type: ItemType): MediaKind | null => (type === 'image' ? 'image' : type === 'audio' ? 'audio' : null);

function ImportedPreview({ asset, assets }: { asset: string; assets: AssetCache | null }) {
  const state = useAssetUrl(assets, asset);
  return state.status === 'ready'
    ? <img src={state.url} alt="" className="h-24 rounded border border-line object-contain" />
    : null;
}

/**
 * Creates a binder item of any type. Mount it fresh for each use (render it
 * only while open) so its fields start from the current defaults.
 */
export function AddItemModal(props: AddItemModalProps) {
  const { initialType, initialParentId, items, assets, importMedia, discardAsset, onCreate, onClose } = props;
  const [type, setType] = useState<ItemType>(initialType);
  const [title, setTitle] = useState('');
  const [parentId, setParentId] = useState<string | null>(initialParentId);
  const [synopsis, setSynopsis] = useState('');
  const [label, setLabel] = useState<LabelId | null>(null);
  const [status, setStatus] = useState<StatusId | null>(null);
  const [url, setUrl] = useState('');
  const [author, setAuthor] = useState('');
  const [entityKind, setEntityKind] = useState<string>('character');
  const [imported, setImported] = useState<ImportedAsset | null>(null);
  const [importing, setImporting] = useState(false);

  const kind = mediaKindOf(type);
  const folders = items.filter(isFolder);
  const folderPath = (f: TreeItem) => [...ancestorsOf(items, f.id), f].map(a => a.title || 'Untitled').join(' › ');

  const forgetImport = () => {
    if (imported) discardAsset(imported.asset);
    setImported(null);
  };

  const chooseType = (next: ItemType) => {
    if (mediaKindOf(next) !== kind) forgetImport();
    setType(next);
  };

  const chooseFile = async () => {
    if (!kind) return;
    setImporting(true);
    try {
      const picked = await importMedia(kind);
      if (!picked) return;
      forgetImport();
      setImported(picked);
      if (!title.trim()) setTitle(picked.originalName);
    } finally {
      setImporting(false);
    }
  };

  const cancel = () => {
    forgetImport();
    onClose();
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const name = title.trim();
    if (!name) return;
    const fields: NewItem = { type, title: name, parentId, label, status };
    if (synopsis.trim()) fields.synopsis = synopsis.trim();
    if (type === 'entity') fields.entityKind = entityKind;
    if (imported) fields.asset = imported.asset;
    if (type === 'webpage') {
      if (url.trim()) fields.url = url.trim();
      if (author.trim()) fields.mediaMetadata = { author: author.trim() };
    }
    onCreate(fields, '');
    onClose();
  };

  return (
    <Modal
      title="Add to binder"
      onClose={cancel}
      footer={(
        <>
          <button type="button" className={btn} onClick={cancel}>Cancel</button>
          <button type="submit" form="add-item-form" className={btnPrimary} disabled={!title.trim() || importing}>Create</button>
        </>
      )}
    >
      <form id="add-item-form" onSubmit={submit} className="flex flex-col gap-4 text-xs">
        <fieldset>
          <legend className={`${fieldLabel} mb-2`}>Type</legend>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-6" role="radiogroup" aria-label="Type">
            {ITEM_TYPES.map(t => (
              <button
                key={t.id}
                type="button"
                role="radio"
                aria-checked={type === t.id}
                onClick={() => chooseType(t.id)}
                className={`flex flex-col items-center gap-1 rounded-md border p-2 ${type === t.id ? 'border-accent bg-accent-soft' : 'border-line hover:border-accent'}`}
              >
                <ItemIcon item={{ type: t.id }} />
                <span className="text-[11px]">{t.name}</span>
              </button>
            ))}
          </div>
        </fieldset>

        <label className="flex flex-col gap-1">
          <span className={fieldLabel}>Title</span>
          <input data-autofocus className={input} value={title} onChange={(e) => setTitle(e.target.value)} required placeholder="e.g. Harbour regulations of 1684" />
        </label>

        <label className="flex flex-col gap-1">
          <span className={fieldLabel}>Folder</span>
          <select className={input} value={parentId ?? ''} onChange={(e) => setParentId(e.target.value || null)}>
            <option value="">Top level</option>
            {folders.map(f => <option key={f.id} value={f.id}>{folderPath(f)}</option>)}
          </select>
        </label>

        {type === 'entity' && (
          <label className="flex flex-col gap-1">
            <span className={fieldLabel}>Kind</span>
            <select className={input} value={entityKind} onChange={(e) => setEntityKind(e.target.value)}>
              {ENTITY_KINDS.map(k => <option key={k.id} value={k.id}>{k.name}</option>)}
            </select>
          </label>
        )}

        {kind && (
          <div className="flex items-center justify-between gap-3 rounded-md border border-line bg-surface-sunken p-3">
            <div className="flex min-w-0 items-center gap-3">
              {imported && kind === 'image' && <ImportedPreview asset={imported.asset} assets={assets} />}
              <span className="truncate text-content-muted">
                {imported ? `${imported.originalName} (${Math.max(1, Math.round(imported.bytes / 1024)).toLocaleString()} KB)` : `No ${kind} file chosen`}
              </span>
            </div>
            <button type="button" className={btn} onClick={() => void chooseFile()} disabled={importing}>
              <Upload className="h-3.5 w-3.5" /> {imported ? 'Choose another…' : 'Choose file…'}
            </button>
          </div>
        )}

        {type === 'webpage' && (
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1">
              <span className={fieldLabel}>Source URL</span>
              <input className={input} type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" />
            </label>
            <label className="flex flex-col gap-1">
              <span className={fieldLabel}>Author</span>
              <input className={input} value={author} onChange={(e) => setAuthor(e.target.value)} />
            </label>
          </div>
        )}

        <label className="flex flex-col gap-1">
          <span className={fieldLabel}>Synopsis</span>
          <textarea className={`${input} resize-none`} rows={2} value={synopsis} onChange={(e) => setSynopsis(e.target.value)} placeholder="Shown on the index card" />
        </label>

        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1">
            <span className={fieldLabel}>Label</span>
            <select className={input} value={label ?? ''} onChange={(e) => setLabel((e.target.value || null) as LabelId | null)}>
              <option value="">No label</option>
              {LABEL_LIST.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className={fieldLabel}>Status</span>
            <select className={input} value={status ?? ''} onChange={(e) => setStatus((e.target.value || null) as StatusId | null)}>
              <option value="">No status</option>
              {STATUS_LIST.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
            </select>
          </label>
        </div>
      </form>
    </Modal>
  );
}
