import { memo, useDeferredValue, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  ChevronDown, ChevronRight, Copy, ExternalLink, FilePlus, FolderPlus, GripVertical, HelpCircle, ListFilter, Plus, Search,
  Trash2,
} from 'lucide-react';
import type { LabelId, TreeItem } from '@/project/types';
import type { DocEntry } from '@/project/projectState';
import { ItemIcon } from '@/components/workspace/ItemIcon';
import { btnGhost, input, segment, segmentGroup } from '@/components/workspace/ui';
import { LABEL_LIST, labelOf } from '@/workspace/research';
import { ALL_SCOPES, findMatches, searchItems, type SearchMode, type SearchScopes, type Snippet } from '@/workspace/search';
import { ancestorsOf, childrenOf, descendantIds, isFolder, type DropPosition } from '@/workspace/treeOps';
import { wordCount } from '@/workspace/stats';

/** Drag data type of a binder item; other panels (chat attachments) accept it as a drop. */
export const BINDER_DRAG_TYPE = 'application/x-vrs-item';

export interface BinderProps {
  projectName: string;
  onRenameProject(name: string): void;
  items: TreeItem[];
  /** Bodies for word counts. */
  docs: Record<string, DocEntry>;
  /** Searchable text of an item (an AI chat's transcript, else its body), or undefined while it loads. */
  textOf(id: string): string | undefined;
  /** AI chats with a reply in flight. */
  streamingIds: ReadonlySet<string>;
  activeId: string | null;
  collapsed: ReadonlySet<string>;
  onToggleFolder(id: string, open?: boolean): void;
  onSelect(id: string | null): void;
  /** Where new items go: the active folder, or the active item's folder. */
  newItemParentId: string | null;
  onNewDocument(parentId: string | null): void;
  onNewFolder(parentId: string | null): void;
  onAddItem(parentId: string | null): void;
  onDelete(id: string): void;
  onDuplicate(id: string): void;
  onQuickRef(id: string): void;
  onMove(id: string, targetId: string | null, position: DropPosition): void;
}

/** Text with every match of `regex` wrapped in <mark>. */
function Highlighted({ text, regex }: { text: string; regex: RegExp | null }) {
  if (!regex) return <>{text}</>;
  const parts: ReactNode[] = [];
  let last = 0;
  findMatches(text, regex, 50).forEach((m, i) => {
    if (m.index > last) parts.push(text.slice(last, m.index));
    parts.push(<mark key={i} className="rounded bg-highlight px-0.5 text-content">{m[0]}</mark>);
    last = m.index + m[0].length;
  });
  parts.push(text.slice(last));
  return <>{parts}</>;
}

function SnippetView({ label, snippet }: { label: string; snippet: Snippet }) {
  return (
    <p className="rounded bg-surface-sunken p-1.5 text-[11px] leading-relaxed text-content-muted">
      <span className="font-semibold">{label}: </span>
      {snippet.before}
      <mark className="rounded bg-highlight px-0.5 text-content">{snippet.match}</mark>
      {snippet.after}
    </p>
  );
}

const SEARCH_EXAMPLES: { mode: SearchMode; query: string; hint: string }[] = [
  { mode: 'wildcard', query: 'harb*', hint: 'starts with "harb"' },
  { mode: 'wildcard', query: 'c?rd', hint: 'one character wildcard' },
  { mode: 'regex', query: '\\b[A-Z]{3,}\\b', hint: 'acronyms' },
  { mode: 'regex', query: '\\b1[0-9]{3}\\b', hint: 'years 1000-1999' },
];

export const Binder = memo(function Binder(props: BinderProps) {
  const {
    projectName, onRenameProject, items, docs, textOf, streamingIds, activeId, collapsed, onToggleFolder, onSelect, newItemParentId,
    onNewDocument, onNewFolder, onAddItem, onDelete, onDuplicate, onQuickRef, onMove,
  } = props;

  const [query, setQuery] = useState('');
  const [mode, setMode] = useState<SearchMode>('text');
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [scopes, setScopes] = useState<SearchScopes>(ALL_SCOPES);
  const [panel, setPanel] = useState<'none' | 'scopes' | 'help'>('none');
  const [labelFilter, setLabelFilter] = useState<LabelId | 'all'>('all');

  // Typing in an editor shouldn't re-run a search on every keystroke.
  const deferredTextOf = useDeferredValue(textOf);
  const result = useMemo(
    () => searchItems(items, deferredTextOf, { query, mode, caseSensitive, scopes, label: labelFilter }),
    [items, deferredTextOf, query, mode, caseSensitive, scopes, labelFilter],
  );
  const searching = query.trim() !== '';
  const scopeCount = Object.values(scopes).filter(Boolean).length;

  const pathOf = (item: TreeItem) => ancestorsOf(items, item.id).map(a => a.title).join(' › ') || 'Top level';
  const folders = items.filter(isFolder).length;

  return (
    <aside aria-label="Binder" className="flex w-72 shrink-0 flex-col border-r border-line bg-surface-raised">
      <div className="flex flex-col gap-2 border-b border-line p-3">
        <label className="flex flex-col gap-1">
          <span className="sr-only">Project name</span>
          <input
            aria-label="Project name"
            className="rounded border border-transparent bg-transparent px-1 py-0.5 font-serif text-base font-bold hover:border-line focus:border-accent focus:outline-none"
            value={projectName}
            onChange={(e) => onRenameProject(e.target.value)}
          />
        </label>
        <div className="flex items-center justify-between">
          <h2 className="text-[11px] font-semibold uppercase tracking-wider text-content-muted">Binder</h2>
          <div className="flex items-center gap-0.5">
            <button type="button" className={btnGhost} onClick={() => onNewFolder(newItemParentId)} aria-label="New folder" title="New folder">
              <FolderPlus className="h-4 w-4" />
            </button>
            <button type="button" className={btnGhost} onClick={() => onNewDocument(newItemParentId)} aria-label="New document" title="New document">
              <FilePlus className="h-4 w-4" />
            </button>
            <button type="button" className={btnGhost} onClick={() => onAddItem(newItemParentId)} aria-label="Add item…" title="Add an image, web clip, audio or other item">
              <Plus className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="relative">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-content-muted" aria-hidden />
          <input
            type="search"
            aria-label="Search the binder"
            aria-invalid={!result.ok}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setQuery('');
            }}
            placeholder={mode === 'regex' ? 'Regular expression…' : mode === 'wildcard' ? 'Wildcards: * and ?' : 'Search titles, cards, text…'}
            className={`${input} w-full pl-7 ${result.ok ? '' : 'border-danger'}`}
          />
        </div>
        <div className="flex items-center justify-between gap-1 text-[11px]">
          <div className={segmentGroup} role="group" aria-label="Search mode">
            {(['text', 'wildcard', 'regex'] as const).map(m => (
              <button key={m} type="button" className={segment(mode === m)} aria-pressed={mode === m} onClick={() => setMode(m)}>
                {m === 'text' ? 'Text' : m === 'wildcard' ? 'Wildcard' : 'Regex'}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-0.5">
            <button
              type="button"
              className={`${btnGhost} font-mono text-[11px] ${caseSensitive ? 'text-accent' : ''}`}
              aria-pressed={caseSensitive}
              aria-label="Match case"
              title="Match case"
              onClick={() => setCaseSensitive(c => !c)}
            >
              Aa
            </button>
            <button
              type="button"
              className={`${btnGhost} text-[11px] ${scopeCount < 4 ? 'text-accent' : ''}`}
              aria-expanded={panel === 'scopes'}
              aria-label={`Search fields (${scopeCount} of 4)`}
              title="Choose which fields to search"
              onClick={() => setPanel(p => (p === 'scopes' ? 'none' : 'scopes'))}
            >
              <ListFilter className="h-3.5 w-3.5" />
              {scopeCount}/4
            </button>
            <button
              type="button"
              className={btnGhost}
              aria-expanded={panel === 'help'}
              aria-label="Search help"
              onClick={() => setPanel(p => (p === 'help' ? 'none' : 'help'))}
            >
              <HelpCircle className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        {panel === 'scopes' && (
          <fieldset className="grid grid-cols-2 gap-1 rounded border border-line bg-surface-sunken p-2 text-[11px]">
            <legend className="sr-only">Search in</legend>
            {([['title', 'Title'], ['synopsis', 'Synopsis'], ['content', 'Text'], ['keywords', 'Keywords']] as const).map(([key, name]) => (
              <label key={key} className="flex items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={scopes[key]}
                  onChange={(e) => setScopes(s => ({ ...s, [key]: e.target.checked }))}
                />
                {name}
              </label>
            ))}
          </fieldset>
        )}
        {panel === 'help' && (
          <div className="space-y-1.5 rounded border border-line bg-surface-sunken p-2 text-[11px] text-content-muted">
            <p><strong className="text-content">Text</strong> finds items containing every word.</p>
            <p><strong className="text-content">Wildcard</strong>: <code>*</code> matches anything, <code>?</code> one character.</p>
            <p><strong className="text-content">Regex</strong> is a JavaScript regular expression.</p>
            <div className="flex flex-wrap gap-1 pt-1">
              {SEARCH_EXAMPLES.map(ex => (
                <button
                  key={ex.query}
                  type="button"
                  title={ex.hint}
                  className="rounded border border-line bg-surface-raised px-1.5 py-0.5 font-mono text-[10px] text-accent"
                  onClick={() => {
                    setMode(ex.mode);
                    setQuery(ex.query);
                  }}
                >
                  {ex.query}
                </button>
              ))}
            </div>
          </div>
        )}
        {!result.ok && (
          <p role="alert" className="rounded border border-danger p-1.5 font-mono text-[11px] text-danger">
            Invalid pattern: {result.error}
          </p>
        )}

        <label className="flex items-center gap-2 text-[11px] text-content-muted">
          Label
          <select
            aria-label="Filter by label"
            className={`${input} min-w-0 flex-1`}
            value={labelFilter}
            onChange={(e) => setLabelFilter(e.target.value as LabelId | 'all')}
          >
            <option value="all">All items</option>
            {LABEL_LIST.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </label>
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        {searching ? (
          result.ok && (
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between px-1 text-[11px] text-content-muted" aria-live="polite">
                <span>
                  {result.hits.length} {result.hits.length === 1 ? 'item' : 'items'} · {result.totalMatches} {result.totalMatches === 1 ? 'match' : 'matches'}
                </span>
                <button type="button" className="underline hover:text-content" onClick={() => setQuery('')}>Clear</button>
              </div>
              <ul aria-label="Search results" className="flex flex-col gap-1.5">
                {result.hits.map(({ item, fields, matches, synopsisSnippet, contentSnippet }) => (
                  <li key={item.id}>
                    <div
                      className={`flex flex-col gap-1 rounded border p-2 text-xs ${item.id === activeId ? 'border-accent bg-accent-soft' : 'border-line hover:border-accent'}`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <button type="button" className="flex min-w-0 items-center gap-1.5 text-left font-semibold" onClick={() => onSelect(item.id)}>
                          <ItemIcon item={item} className="h-3.5 w-3.5" />
                          <span className="truncate"><Highlighted text={item.title || 'Untitled'} regex={result.highlight} /></span>
                        </button>
                        <button type="button" className={btnGhost} aria-label={`Quick reference for ${item.title}`} onClick={() => onQuickRef(item.id)}>
                          <ExternalLink className="h-3 w-3" />
                        </button>
                      </div>
                      <div className="flex items-center justify-between gap-2 text-[10px] text-content-muted">
                        <span className="truncate font-mono">{pathOf(item)}</span>
                        <span className="shrink-0">
                          {[fields.title && 'title', fields.synopsis && 'synopsis', fields.content && 'text', fields.keywords && 'keyword']
                            .filter(Boolean).join(', ')} ({matches})
                        </span>
                      </div>
                      {synopsisSnippet && <SnippetView label="Synopsis" snippet={synopsisSnippet} />}
                      {contentSnippet && <SnippetView label="Text" snippet={contentSnippet} />}
                    </div>
                  </li>
                ))}
              </ul>
              {result.hits.length === 0 && (
                <div className="flex flex-col items-center gap-2 px-3 py-8 text-center text-xs text-content-muted">
                  <p>No items match “{query}”.</p>
                  <button
                    type="button"
                    className="underline hover:text-content"
                    onClick={() => {
                      setScopes(ALL_SCOPES);
                      setLabelFilter('all');
                      setMode('text');
                    }}
                  >
                    Reset search options
                  </button>
                </div>
              )}
            </div>
          )
        ) : labelFilter !== 'all' ? (
          <ul aria-label="Filtered items" className="flex flex-col gap-0.5">
            {items.filter(i => i.label === labelFilter).map(item => (
              <li key={item.id}>
                <button
                  type="button"
                  className={`flex w-full items-center gap-2 rounded px-2 py-1 text-left text-xs ${item.id === activeId ? 'bg-accent-soft font-medium' : 'hover:bg-surface-sunken'}`}
                  onClick={() => onSelect(item.id)}
                >
                  <ItemIcon item={item} className="h-3.5 w-3.5" />
                  <span className="truncate">{item.title || 'Untitled'}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <BinderTree
            items={items}
            streamingIds={streamingIds}
            activeId={activeId}
            collapsed={collapsed}
            onToggleFolder={onToggleFolder}
            onSelect={onSelect}
            onNewDocument={onNewDocument}
            onDelete={onDelete}
            onDuplicate={onDuplicate}
            onQuickRef={onQuickRef}
            onMove={onMove}
          />
        )}
      </div>

      <div className="flex items-center justify-between border-t border-line px-3 py-2 text-[11px] text-content-muted">
        <span>{items.length} items</span>
        <span>{folders} folders · {items.length - folders} documents · {Object.values(docs).reduce((n, d) => n + wordCount(d.current), 0).toLocaleString()} words</span>
      </div>
    </aside>
  );
});

interface TreeProps {
  items: TreeItem[];
  streamingIds: ReadonlySet<string>;
  activeId: string | null;
  collapsed: ReadonlySet<string>;
  onToggleFolder(id: string, open?: boolean): void;
  onSelect(id: string | null): void;
  onNewDocument(parentId: string | null): void;
  onDelete(id: string): void;
  onDuplicate(id: string): void;
  onQuickRef(id: string): void;
  onMove(id: string, targetId: string | null, position: DropPosition): void;
}

interface VisibleRow {
  item: TreeItem;
  depth: number;
  /** 1-based position among its siblings, and the sibling count (aria-posinset / aria-setsize). */
  position: number;
  setSize: number;
}

function BinderTree({ items, streamingIds, activeId, collapsed, onToggleFolder, onSelect, onNewDocument, onDelete, onDuplicate, onQuickRef, onMove }: TreeProps) {
  const [dragged, setDragged] = useState<string | null>(null);
  const [drop, setDrop] = useState<{ id: string | null; position: DropPosition } | null>(null);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const rowRefs = useRef(new Map<string, HTMLLIElement>());

  const isOpen = (item: TreeItem) => isFolder(item) && !collapsed.has(item.id);

  // Rows in display order, for keyboard navigation.
  const rows = useMemo(() => {
    const out: VisibleRow[] = [];
    const seen = new Set<string>();
    const walk = (parentId: string | null, depth: number) => {
      const siblings = childrenOf(items, parentId).filter(i => !seen.has(i.id));
      for (const [i, item] of siblings.entries()) {
        if (seen.has(item.id)) continue;
        seen.add(item.id);
        out.push({ item, depth, position: i + 1, setSize: siblings.length });
        if (isFolder(item) && !collapsed.has(item.id)) walk(item.id, depth + 1);
      }
    };
    walk(null, 0);
    return out;
  }, [items, collapsed]);

  const tabStop = focusedId && rows.some(r => r.item.id === focusedId) ? focusedId : (activeId ?? rows[0]?.item.id);

  // Hovering a collapsed folder while dragging opens it.
  useEffect(() => {
    if (!dragged || drop?.position !== 'inside' || !drop.id || !collapsed.has(drop.id)) return;
    const id = drop.id;
    const timer = setTimeout(() => onToggleFolder(id, true), 700);
    return () => clearTimeout(timer);
  }, [dragged, drop, collapsed, onToggleFolder]);

  const focusRow = (id: string | undefined) => {
    if (!id) return;
    setFocusedId(id);
    rowRefs.current.get(id)?.focus();
  };

  const onRowKeyDown = (e: React.KeyboardEvent, row: VisibleRow, index: number) => {
    const { item } = row;
    if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault();
      const siblings = childrenOf(items, item.parentId);
      const at = siblings.findIndex(s => s.id === item.id);
      const neighbour = siblings[e.key === 'ArrowUp' ? at - 1 : at + 1];
      if (neighbour) onMove(item.id, neighbour.id, e.key === 'ArrowUp' ? 'before' : 'after');
      return;
    }
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        focusRow(rows[index + 1]?.item.id);
        break;
      case 'ArrowUp':
        e.preventDefault();
        focusRow(rows[index - 1]?.item.id);
        break;
      case 'Home':
        e.preventDefault();
        focusRow(rows[0]?.item.id);
        break;
      case 'End':
        e.preventDefault();
        focusRow(rows[rows.length - 1]?.item.id);
        break;
      case 'ArrowRight':
        e.preventDefault();
        if (isFolder(item) && !isOpen(item)) onToggleFolder(item.id, true);
        else if (isOpen(item)) focusRow(rows[index + 1]?.depth === row.depth + 1 ? rows[index + 1].item.id : undefined);
        break;
      case 'ArrowLeft':
        e.preventDefault();
        if (isOpen(item)) onToggleFolder(item.id, false);
        else if (item.parentId) focusRow(item.parentId);
        break;
      case 'Enter':
      case ' ':
        e.preventDefault();
        onSelect(item.id);
        break;
      case 'Delete':
        e.preventDefault();
        onDelete(item.id);
        break;
    }
  };

  const dropPosition = (e: React.DragEvent, item: TreeItem): DropPosition => {
    const rect = e.currentTarget.getBoundingClientRect();
    const y = (e.clientY - rect.top) / Math.max(rect.height, 1);
    if (isFolder(item)) return y < 0.25 ? 'before' : y > 0.75 ? 'after' : 'inside';
    return y < 0.5 ? 'before' : 'after';
  };

  const endDrag = () => {
    setDragged(null);
    setDrop(null);
  };

  const renderRow = (row: VisibleRow, index: number) => {
    const { item, depth, position, setSize } = row;
    const folder = isFolder(item);
    const open = isOpen(item);
    const label = labelOf(item);
    const childCount = folder ? items.filter(i => i.parentId === item.id).length : 0;
    const target = drop?.id === item.id ? drop.position : null;
    const title = item.title || 'Untitled';

    return (
      <li
        key={item.id}
        role="treeitem"
        aria-label={title}
        aria-level={depth + 1}
        aria-posinset={position}
        aria-setsize={setSize}
        aria-selected={item.id === activeId}
        aria-expanded={folder ? open : undefined}
        ref={(el) => {
          if (el) rowRefs.current.set(item.id, el);
          else rowRefs.current.delete(item.id);
        }}
        tabIndex={item.id === tabStop ? 0 : -1}
        draggable
        onFocus={() => setFocusedId(item.id)}
        onClick={() => onSelect(item.id)}
        onKeyDown={(e) => {
          if (e.target === e.currentTarget) onRowKeyDown(e, row, index);
        }}
        onDragStart={(e) => {
          e.dataTransfer.setData(BINDER_DRAG_TYPE, item.id);
          e.dataTransfer.effectAllowed = 'move';
          setDragged(item.id);
        }}
        onDragEnd={endDrag}
        onDragOver={(e) => {
          if (!dragged || dragged === item.id || descendantIds(items, dragged).has(item.id)) return;
          e.preventDefault();
          const position = dropPosition(e, item);
          if (drop?.id !== item.id || drop.position !== position) setDrop({ id: item.id, position });
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null) && drop?.id === item.id) setDrop(null);
        }}
        onDrop={(e) => {
          e.preventDefault();
          const id = e.dataTransfer.getData(BINDER_DRAG_TYPE) || dragged;
          if (id && drop?.id === item.id) onMove(id, item.id, drop.position);
          endDrag();
        }}
        className={`group relative flex cursor-pointer items-center gap-1 rounded py-1 pr-1 text-xs outline-none focus-visible:ring-2 focus-visible:ring-accent ${
          item.id === activeId ? 'bg-accent-soft font-medium text-content' : 'text-content hover:bg-surface-sunken'
        } ${dragged === item.id ? 'opacity-40' : ''} ${target === 'inside' ? 'ring-2 ring-accent' : ''}`}
        style={{ paddingLeft: depth * 12 + 4 }}
      >
        {target === 'before' && <div className="pointer-events-none absolute -top-px left-1 right-1 z-10 h-0.5 rounded bg-accent" />}
        {target === 'after' && <div className="pointer-events-none absolute -bottom-px left-1 right-1 z-10 h-0.5 rounded bg-accent" />}
        <GripVertical className="h-3 w-3 shrink-0 text-content-muted opacity-0 group-hover:opacity-60" aria-hidden />
        {folder ? (
          <button
            type="button"
            tabIndex={-1}
            className="rounded p-0.5 text-content-muted hover:text-content"
            aria-label={open ? `Collapse ${title}` : `Expand ${title}`}
            onClick={(e) => {
              e.stopPropagation();
              onToggleFolder(item.id);
            }}
          >
            {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          </button>
        ) : (
          <span className="w-[18px] shrink-0" />
        )}
        <ItemIcon item={item} open={open} className="h-4 w-4 text-content-muted" />
        {label && <span className="h-3 w-1 shrink-0 rounded-sm" style={{ backgroundColor: label.color }} title={label.name} />}
        <span className="min-w-0 flex-1 truncate">{title}</span>
        {streamingIds.has(item.id) && <span className="shrink-0 text-[10px] italic text-accent">replying…</span>}
        {folder && childCount > 0 && <span className="shrink-0 font-mono text-[10px] text-content-muted">{childCount}</span>}
        <span className="flex shrink-0 items-center opacity-0 group-focus-within:opacity-100 group-hover:opacity-100">
          <RowAction label={`Quick reference for ${title}`} onClick={() => onQuickRef(item.id)}><ExternalLink className="h-3 w-3" /></RowAction>
          {folder && <RowAction label={`New document in ${title}`} onClick={() => onNewDocument(item.id)}><Plus className="h-3 w-3" /></RowAction>}
          <RowAction label={`Duplicate ${title}`} onClick={() => onDuplicate(item.id)}><Copy className="h-3 w-3" /></RowAction>
          <RowAction label={`Delete ${title}`} onClick={() => onDelete(item.id)} danger><Trash2 className="h-3 w-3" /></RowAction>
        </span>
      </li>
    );
  };

  if (!items.length) {
    return <p className="px-2 py-6 text-center text-xs text-content-muted">The binder is empty. Add a document or folder to start.</p>;
  }

  return (
    <>
      {/* A flat tree (levels via aria-level), so each treeitem is exactly its own row. */}
      <ul role="tree" aria-label="Binder items" className="flex flex-col">
        {rows.map(renderRow)}
      </ul>
      {dragged && (
        <div
          onDragOver={(e) => {
            e.preventDefault();
            if (drop?.id !== null) setDrop({ id: null, position: 'inside' });
          }}
          onDragLeave={() => setDrop(null)}
          onDrop={(e) => {
            e.preventDefault();
            const id = e.dataTransfer.getData(BINDER_DRAG_TYPE) || dragged;
            if (id) onMove(id, null, 'inside');
            endDrag();
          }}
          className={`mt-2 rounded border-2 border-dashed p-2 text-center text-xs ${drop?.id === null ? 'border-accent bg-accent-soft' : 'border-line text-content-muted'}`}
        >
          Move to top level
        </div>
      )}
    </>
  );
}

function RowAction({ label, onClick, danger, children }: { label: string; onClick(): void; danger?: boolean; children: ReactNode }) {
  return (
    <button
      type="button"
      tabIndex={-1}
      aria-label={label}
      title={label}
      className={`rounded p-1 text-content-muted hover:bg-surface-raised ${danger ? 'hover:text-danger' : 'hover:text-content'}`}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
    >
      {children}
    </button>
  );
}
