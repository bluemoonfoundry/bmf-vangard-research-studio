import { useState } from 'react';
import { ArrowDown, ArrowUp, BookOpen, Columns2, Plus, Trash2 } from 'lucide-react';
import type { LabelId, StatusId, TreeItem } from '@/project/types';
import { ITEM_TYPES, LABEL_LIST, LABELS, STATUSES, STATUS_LIST, itemType } from '@/workspace/research';
import { wordCount } from '@/workspace/stats';
import { byOrder } from '@/workspace/treeOps';
import { ItemIcon } from '@/components/workspace/ItemIcon';
import type { ContainerViewProps } from '@/components/workspace/CorkboardView';
import { btnGhost, btnPrimary } from '@/components/workspace/ui';

type SortKey = 'order' | 'title' | 'type' | 'label' | 'status' | 'words';

const typeName = new Map(ITEM_TYPES.map(t => [t.id, t.name]));
const cellInput = 'w-full rounded border border-transparent bg-transparent px-1 py-0.5 hover:border-line focus:border-accent focus:outline-none';

/** A sortable table of a folder's children with inline editing. */
export function OutlinerView(props: ContainerViewProps) {
  const { folderTitle, children, docs, selectedId, onSelect, onOpen, onOpenInSplit, onUpdate, onCreate, onDelete } = props;
  const [sort, setSort] = useState<{ key: SortKey; asc: boolean }>({ key: 'order', asc: true });

  const words = (item: TreeItem) => (docs[item.id] ? wordCount(docs[item.id].current) : -1);
  const sortValue: Record<SortKey, (i: TreeItem) => string | number> = {
    order: i => i.order,
    title: i => i.title.toLocaleLowerCase(),
    type: i => typeName.get(itemType(i)) ?? '',
    label: i => (i.label && LABELS[i.label]?.name) || '￿',
    status: i => (i.status && STATUSES[i.status]) || '￿',
    words,
  };
  const rows = [...children].sort((a, b) => {
    const va = sortValue[sort.key](a);
    const vb = sortValue[sort.key](b);
    const cmp = typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb));
    return (sort.asc ? cmp : -cmp) || byOrder(a, b);
  });

  const header = (key: SortKey, name: string, className = '') => (
    <th scope="col" className={`px-3 py-2 font-medium ${className}`} aria-sort={sort.key === key ? (sort.asc ? 'ascending' : 'descending') : undefined}>
      <button
        type="button"
        className="inline-flex items-center gap-1 hover:text-accent"
        onClick={() => setSort(s => ({ key, asc: s.key === key ? !s.asc : true }))}
      >
        {name}
        {sort.key === key && (sort.asc ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />)}
      </button>
    </th>
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex h-11 shrink-0 items-center justify-between gap-3 border-b border-line bg-surface-raised px-4 text-xs">
        <div className="flex min-w-0 items-center gap-2">
          <h2 className="truncate font-serif text-sm font-semibold">{folderTitle}</h2>
          <span className="text-content-muted">{children.length} {children.length === 1 ? 'item' : 'items'}</span>
          {sort.key !== 'order' && (
            <button type="button" className="text-content-muted underline hover:text-content" onClick={() => setSort({ key: 'order', asc: true })}>
              Binder order
            </button>
          )}
        </div>
        <button type="button" className={btnPrimary} onClick={onCreate}><Plus className="h-3.5 w-3.5" /> New row</button>
      </div>
      <div className="flex-1 overflow-auto">
        <table className="w-full border-collapse text-left text-xs">
          <thead className="sticky top-0 z-10 border-b border-line bg-surface-raised text-[11px] text-content-muted">
            <tr>
              {header('title', 'Title', 'min-w-[220px]')}
              <th scope="col" className="min-w-[260px] px-3 py-2 font-medium">Synopsis</th>
              {header('type', 'Type')}
              {header('label', 'Label')}
              {header('status', 'Status')}
              {header('words', 'Words', 'text-right')}
              <th scope="col" className="px-3 py-2 text-center font-medium">Links</th>
              <th scope="col" className="px-3 py-2"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((item) => {
              const title = item.title || 'Untitled';
              const w = words(item);
              return (
                <tr
                  key={item.id}
                  aria-selected={item.id === selectedId}
                  onClick={() => onSelect(item.id)}
                  onDoubleClick={() => onOpen(item.id)}
                  className={`group ${item.id === selectedId ? 'bg-accent-soft' : 'hover:bg-surface-sunken'}`}
                >
                  <td className="px-3 py-1.5">
                    <div className="flex items-center gap-1.5">
                      <ItemIcon item={item} className="h-3.5 w-3.5 text-content-muted" />
                      <input aria-label={`Title of ${title}`} className={`${cellInput} font-medium`} value={item.title} onChange={(e) => onUpdate(item.id, { title: e.target.value })} />
                    </div>
                  </td>
                  <td className="px-3 py-1.5">
                    <input aria-label={`Synopsis of ${title}`} className={`${cellInput} text-content-muted`} value={item.synopsis ?? ''} placeholder="Add synopsis…" onChange={(e) => onUpdate(item.id, { synopsis: e.target.value })} />
                  </td>
                  <td className="px-3 py-1.5 text-[10px] uppercase tracking-wider text-content-muted">{typeName.get(itemType(item))}</td>
                  <td className="px-3 py-1.5">
                    <select aria-label={`Label of ${title}`} className={`${cellInput} min-w-32`} value={item.label ?? ''} onChange={(e) => onUpdate(item.id, { label: (e.target.value || null) as LabelId | null })}>
                      <option value="">—</option>
                      {LABEL_LIST.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
                    </select>
                  </td>
                  <td className="px-3 py-1.5">
                    <select aria-label={`Status of ${title}`} className={`${cellInput} min-w-28`} value={item.status ?? ''} onChange={(e) => onUpdate(item.id, { status: (e.target.value || null) as StatusId | null })}>
                      <option value="">—</option>
                      {STATUS_LIST.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
                    </select>
                  </td>
                  <td className="px-3 py-1.5 text-right font-mono tabular-nums text-content-muted">{w >= 0 ? w : ''}</td>
                  <td className="px-3 py-1.5 text-center font-mono tabular-nums text-content-muted">{item.references?.length ?? 0}</td>
                  <td className="px-2 py-1.5">
                    <div className="flex justify-end opacity-0 group-focus-within:opacity-100 group-hover:opacity-100">
                      <button type="button" className={btnGhost} aria-label={`Open ${title} in split view`} onClick={(e) => { e.stopPropagation(); onOpenInSplit(item.id); }}><Columns2 className="h-3 w-3" /></button>
                      <button type="button" className={btnGhost} aria-label={`Open ${title}`} onClick={(e) => { e.stopPropagation(); onOpen(item.id); }}><BookOpen className="h-3 w-3" /></button>
                      <button type="button" className={`${btnGhost} hover:text-danger`} aria-label={`Delete ${title}`} onClick={(e) => { e.stopPropagation(); onDelete(item.id); }}><Trash2 className="h-3 w-3" /></button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {children.length === 0 && <p className="p-8 text-center text-xs text-content-muted">This folder is empty.</p>}
      </div>
    </div>
  );
}
