import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, BookOpen, CalendarRange, MessageSquare, Columns2, LayoutGrid, Plus, Rows2, SlidersHorizontal, Square, Table, Download, X } from 'lucide-react';
import type { FactSource, ItemType, MediaKind, TreeItem } from '@/project/types';
import type { ProjectController } from '@/project/useProject';
import { openExternal } from '@/project/api';
import { ancestorsOf, descendantIds, isFolder } from '@/workspace/treeOps';
import { Binder } from '@/components/workspace/Binder';
import { DocumentEditor } from '@/components/workspace/DocumentEditor';
import { CorkboardView, type ContainerViewProps } from '@/components/workspace/CorkboardView';
import { OutlinerView } from '@/components/workspace/OutlinerView';
import { Inspector } from '@/components/workspace/Inspector';
import { SplitPane, type SplitOrientation } from '@/components/workspace/SplitPane';
import { ImportChatModal } from '@/components/bible/ImportChatModal';
import { normalizeChatText } from '@/bible/entities';
import { findContradictions, openContradictions } from '@/bible/contradictions';
import { ConflictQueue } from '@/components/bible/ConflictQueue';
import { TimelineView } from '@/components/bible/TimelineView';
import { resolveSource } from '@/bible/sources';
import { factsCitingItems } from '@/bible/links';
import { AddItemModal } from '@/components/workspace/AddItemModal';
import { QuickRefPanel } from '@/components/workspace/QuickRefPanel';
import { ExportModal } from '@/components/workspace/ExportModal';
import { ConfirmDialog } from '@/components/workspace/ConfirmDialog';
import { btn, btnGhost, btnPrimary, input, segment, segmentGroup } from '@/components/workspace/ui';

/** What the content area shows: the research panes, the conflict queue, or the timeline. */
export type WorkspaceMode = 'research' | 'conflicts' | 'timeline';

/** How a folder (or the top level) is shown. Non-folder items always open in the editor. */
export type FolderView = 'corkboard' | 'outliner' | 'editor';

interface Split {
  orientation: SplitOrientation;
  /** Item shown in the second pane; null = the top level. */
  id: string | null;
  view: FolderView;
}

const VIEWS: { id: FolderView; name: string; icon: typeof BookOpen; key: string }[] = [
  { id: 'corkboard', name: 'Corkboard', icon: LayoutGrid, key: '2' },
  { id: 'outliner', name: 'Outliner', icon: Table, key: '3' },
  { id: 'editor', name: 'Document', icon: BookOpen, key: '1' },
];

/** The research workspace: binder, one or two content panes, inspector, and dialogs. */
export function Workspace({ project }: { project: ProjectController }) {
  const state = project.state!;
  const items = state.tree.items;
  const { docs } = state;
  const {
    addItem, updateItem, editDoc, moveItem, deleteItem, duplicateItem, loadAllDocs, importMedia, importText, discardAsset,
    renameProject, exportDossier, reportError, assets, updateBible,
  } = project;

  const [activeId, setActiveId] = useState<string | null>(null);
  const [folderView, setFolderView] = useState<FolderView>('corkboard');
  /** A card/row picked in a corkboard or outliner; the inspector follows it. */
  const [inspectedId, setInspectedId] = useState<string | null>(null);
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const [split, setSplit] = useState<Split | null>(null);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const [quickRefId, setQuickRefId] = useState<string | null>(null);
  const [adding, setAdding] = useState<{ type: ItemType; parentId: string | null } | null>(null);
  const [importingChat, setImportingChat] = useState<{ parentId: string | null } | null>(null);
  /** A fact's passage to show once its source opens; cleared by any other navigation. */
  const [highlight, setHighlight] = useState<{ itemId: string; start: number; end: number } | null>(null);
  const [mode, setMode] = useState<WorkspaceMode>('research');
  const [conflictKey, setConflictKey] = useState<string | undefined>(undefined);
  const [exporting, setExporting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const byId = useMemo(() => new Map(items.map(i => [i.id, i])), [items]);
  // Ids can vanish (deleted, or the tree reloaded from disk): fall back to the top level.
  const active = (activeId && byId.get(activeId)) || null;
  const inspected = (inspectedId && byId.get(inspectedId)) || active;
  const quickRef = quickRefId ? byId.get(quickRefId) : undefined;
  const contentOf = useCallback((id: string) => docs[id]?.current, [docs]);

  // Search, word counts and export need every body; read them all once, and again for items added on disk.
  useEffect(() => {
    if (items.some(i => !docs[i.id])) void loadAllDocs();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only new items can need loading
  }, [items, loadAllDocs]);

  /** Where "new" goes: the active folder, or the folder holding the active item. */
  const newItemParentId = active ? (isFolder(active) ? active.id : active.parentId) : null;

  const expand = useCallback((id: string | null) => {
    if (!id) return;
    setCollapsed(c => {
      if (!c.has(id)) return c;
      const next = new Set(c);
      next.delete(id);
      return next;
    });
  }, []);

  const openContradictionCount = useMemo(() => {
    const ids = new Set(items.filter(i => i.type === 'entity').map(i => i.id));
    return openContradictions(findContradictions(state.bible, ids)).length;
  }, [items, state.bible]);

  const showConflict = useCallback((key: string) => {
    setConflictKey(key);
    setMode('conflicts');
  }, []);

  const navigate = useCallback((id: string | null) => {
    setMode('research');
    setActiveId(id);
    setInspectedId(null);
    setHighlight(null);
    if (id) for (const a of ancestorsOf(items, id)) expand(a.id);
  }, [items, expand]);

  const openSource = useCallback((source: FactSource) => {
    const resolved = resolveSource(source, docs[source.itemId]?.current, items.some(i => i.id === source.itemId));
    navigate(source.itemId);
    if (resolved.status === 'exact' || resolved.status === 'relocated') {
      setHighlight({ itemId: source.itemId, start: resolved.start, end: resolved.end });
    }
  }, [docs, items, navigate]);

  const toggleFolder = useCallback((id: string, open?: boolean) => {
    setCollapsed(c => {
      const isOpen = !c.has(id);
      if (open !== undefined && open === isOpen) return c;
      const next = new Set(c);
      if (isOpen) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  const newDocument = useCallback((parentId: string | null) => {
    expand(parentId);
    navigate(addItem({ type: 'document', title: 'Untitled document', parentId }));
  }, [addItem, expand, navigate]);

  const newFolder = useCallback((parentId: string | null) => {
    expand(parentId);
    navigate(addItem({ type: 'folder', title: 'New folder', parentId }));
    setFolderView(v => (v === 'editor' ? 'corkboard' : v));
  }, [addItem, expand, navigate]);

  const openAdd = useCallback((parentId: string | null, type: ItemType = 'document') => setAdding({ type, parentId }), []);

  const duplicate = useCallback(async (id: string) => {
    const copy = await duplicateItem(id);
    if (copy) navigate(copy);
  }, [duplicateItem, navigate]);

  const openLink = useCallback((url: string) => {
    openExternal(window.vrs, url).catch((err: unknown) => reportError(`Couldn't open link: ${err instanceof Error ? err.message : String(err)}`));
  }, [reportError]);

  const attachMedia = useCallback(async (item: TreeItem, kind: MediaKind) => {
    const picked = await importMedia(kind);
    if (!picked) return;
    if (item.asset) discardAsset(item.asset);
    updateItem(item.id, { asset: picked.asset });
  }, [importMedia, discardAsset, updateItem]);

  const openSplit = useCallback((id: string | null, orientation: SplitOrientation = 'vertical') => {
    setSplit(s => ({ orientation: s?.orientation ?? orientation, id, view: s?.view ?? 'corkboard' }));
  }, []);

  /** Shows a view; from a non-folder item, Corkboard/Outliner switch to its folder. */
  const showView = useCallback((view: FolderView) => {
    setFolderView(view);
    if (view !== 'editor' && active && !isFolder(active)) navigate(active.parentId);
  }, [active, navigate]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return;
      const view = VIEWS.find(v => v.key === e.key);
      if (view) {
        e.preventDefault();
        showView(view.id);
      } else if (e.key.toLowerCase() === 'i') {
        e.preventDefault();
        setInspectorOpen(o => !o);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [showView]);

  const breadcrumbs = (item: TreeItem) => [
    { id: null, title: state.manifest.name },
    ...ancestorsOf(items, item.id).map(a => ({ id: a.id, title: a.title })),
    { id: item.id, title: item.title },
  ];

  /** One content pane: an editor for items, or a corkboard/outliner/editor for folders and the top level. */
  const renderPane = (item: TreeItem | null, view: FolderView, open: (id: string | null) => void) => {
    if (item && (!isFolder(item) || view === 'editor')) {
      return (
        <DocumentEditor
          key={item.id}
          item={item}
          content={contentOf(item.id)}
          breadcrumbs={breadcrumbs(item)}
          assets={assets}
          onNavigate={open}
          onChangeContent={editDoc}
          onUpdate={updateItem}
          onAttachMedia={(i, kind) => void attachMedia(i, kind)}
          onOpenLink={openLink}
          addEntity={(entityKind, title, parentId) => addItem({ type: 'entity', entityKind, title, parentId })}
          highlight={highlight?.itemId === item.id ? highlight : null}
          bible={{
            items,
            bible: state.bible,
            bodyOf: contentOf,
            updateBible,
            onShowConflict: showConflict,
            onOpenSource: openSource,
            onOpenEntity: navigate,
          }}
        />
      );
    }
    const containerId = item?.id ?? null;
    const children = items.filter(i => i.parentId === containerId).sort((a, b) => a.order - b.order);
    const containerProps: ContainerViewProps = {
      folder: item,
      folderTitle: item?.title || (item ? 'Untitled' : state.manifest.name),
      children,
      docs,
      selectedId: inspectedId,
      onSelect: setInspectedId,
      onOpen: open,
      onOpenInSplit: (id) => openSplit(id),
      onUpdate: updateItem,
      onCreate: () => newDocument(containerId),
      onDelete: setConfirmDelete,
      onMove: moveItem,
    };
    return view === 'outliner'
      ? <OutlinerView {...containerProps} />
      : <CorkboardView {...containerProps} assets={assets} />;
  };

  const activeIsLeaf = active !== null && !isFolder(active);
  const shownView: FolderView = activeIsLeaf ? 'editor' : active === null && folderView === 'editor' ? 'corkboard' : folderView;
  const secondary = split ? (split.id === null ? null : byId.get(split.id)) : undefined;
  const splitOpen = split !== null && secondary !== undefined;

  const primaryPane = renderPane(active, shownView, navigate);

  const secondaryPane = split && splitOpen && (
    <div className="flex min-h-0 flex-1 flex-col" aria-label="Second pane" role="region">
      <div className="flex h-9 shrink-0 items-center justify-between gap-2 border-b border-line bg-surface-raised px-3 text-xs">
        <select
          aria-label="Item in second pane"
          className={`${input} min-w-0 max-w-xs`}
          value={split.id ?? ''}
          onChange={(e) => setSplit({ ...split, id: e.target.value || null })}
        >
          <option value="">{state.manifest.name} (top level)</option>
          {items.map(i => (
            <option key={i.id} value={i.id}>{'  '.repeat(ancestorsOf(items, i.id).length)}{i.title || 'Untitled'}</option>
          ))}
        </select>
        <div className="flex items-center gap-1">
          {(secondary === null || isFolder(secondary)) && (
            <div className={segmentGroup} role="group" aria-label="Second pane view">
              {VIEWS.filter(v => secondary !== null || v.id !== 'editor').map(v => (
                <button key={v.id} type="button" className={segment(split.view === v.id)} aria-pressed={split.view === v.id} aria-label={v.name} title={v.name} onClick={() => setSplit({ ...split, view: v.id })}>
                  <v.icon className="h-3 w-3" />
                </button>
              ))}
            </div>
          )}
          <button
            type="button"
            className={btnGhost}
            aria-label={split.orientation === 'vertical' ? 'Stack panes' : 'Panes side by side'}
            title={split.orientation === 'vertical' ? 'Stack panes' : 'Panes side by side'}
            onClick={() => setSplit({ ...split, orientation: split.orientation === 'vertical' ? 'horizontal' : 'vertical' })}
          >
            {split.orientation === 'vertical' ? <Rows2 className="h-3.5 w-3.5" /> : <Columns2 className="h-3.5 w-3.5" />}
          </button>
          <button type="button" className={btnGhost} aria-label="Close second pane" onClick={() => setSplit(null)}>
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
      {renderPane(secondary ?? null, secondary === null && split.view === 'editor' ? 'corkboard' : split.view, (id) => setSplit({ ...split, id }))}
    </div>
  );

  const deleting = confirmDelete ? byId.get(confirmDelete) : undefined;
  const deletingIds = useMemo(() => (deleting ? descendantIds(items, deleting.id) : new Set<string>()), [deleting, items]);
  const deletingCount = deleting ? deletingIds.size - 1 : 0;
  const citing = deleting ? factsCitingItems(state.bible, deletingIds).length : 0;
  const aboutIt = deleting ? state.bible.facts.filter(f => deletingIds.has(f.entityId)).length : 0;
  const factWarning = [
    citing ? ` ${citing === 1 ? "1 fact cites this item. It'll keep its quote." : `${citing} facts cite this item. They'll keep their quotes.`}` : '',
    aboutIt ? ` This removes ${aboutIt} ${aboutIt === 1 ? 'fact' : 'facts'} about it.` : '',
  ].join('');

  const startSplit = (orientation: SplitOrientation) => {
    if (split) {
      setSplit({ ...split, orientation });
      return;
    }
    const other = items.find(i => i.id !== active?.id);
    openSplit(other?.id ?? null, orientation);
  };

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="flex h-10 shrink-0 items-center justify-between gap-3 border-b border-line bg-surface-raised px-4 text-xs">
        <div className="flex min-w-0 items-center gap-3">
          <div className={segmentGroup} role="group" aria-label="View">
            {VIEWS.map(v => (
              <button
                key={v.id}
                type="button"
                className={segment(shownView === v.id)}
                aria-pressed={shownView === v.id}
                title={`${v.name} (Ctrl+${v.key})`}
                onClick={() => showView(v.id)}
              >
                <v.icon className="h-3.5 w-3.5" /> {v.name}
              </button>
            ))}
          </div>
          <span className="hidden truncate text-content-muted lg:inline">
            {active ? active.title || 'Untitled' : state.manifest.name}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" className={btnPrimary} onClick={() => openAdd(newItemParentId)}>
            <Plus className="h-3.5 w-3.5" /> New item
          </button>
          <button type="button" className={btn} onClick={() => setImportingChat({ parentId: newItemParentId })}>
            <MessageSquare className="h-3.5 w-3.5" /> Import chat
          </button>
          <button type="button" className={btn} onClick={() => setExporting(true)}>
            <Download className="h-3.5 w-3.5" /> Export
          </button>
          <button type="button" className={segment(mode === 'conflicts')} aria-pressed={mode === 'conflicts'} onClick={() => { setConflictKey(undefined); setMode(m => (m === 'conflicts' ? 'research' : 'conflicts')); }}>
            <AlertTriangle className="h-3.5 w-3.5" /> Conflicts
            <span className="rounded-full bg-surface-sunken px-1.5 text-[11px] text-content" aria-label={`${openContradictionCount} open`}>{openContradictionCount}</span>
          </button>
          <button type="button" className={segment(mode === 'timeline')} aria-pressed={mode === 'timeline'} onClick={() => setMode(m => (m === 'timeline' ? 'research' : 'timeline'))}>
            <CalendarRange className="h-3.5 w-3.5" /> Timeline
          </button>
          <div className={segmentGroup} role="group" aria-label="Layout">
            <button type="button" className={segment(!splitOpen)} aria-pressed={!splitOpen} aria-label="Single pane" title="Single pane" onClick={() => setSplit(null)}>
              <Square className="h-3.5 w-3.5" />
            </button>
            <button type="button" className={segment(splitOpen && split?.orientation === 'vertical')} aria-pressed={splitOpen && split?.orientation === 'vertical'} aria-label="Split side by side" title="Split side by side" onClick={() => startSplit('vertical')}>
              <Columns2 className="h-3.5 w-3.5" />
            </button>
            <button type="button" className={segment(splitOpen && split?.orientation === 'horizontal')} aria-pressed={splitOpen && split?.orientation === 'horizontal'} aria-label="Split stacked" title="Split stacked" onClick={() => startSplit('horizontal')}>
              <Rows2 className="h-3.5 w-3.5" />
            </button>
          </div>
          <button
            type="button"
            className={segment(inspectorOpen)}
            aria-pressed={inspectorOpen}
            title="Inspector (Ctrl+I)"
            onClick={() => setInspectorOpen(o => !o)}
          >
            <SlidersHorizontal className="h-3.5 w-3.5" /> Inspector
          </button>
        </div>
      </div>

      <div className="flex min-h-0 min-w-0 flex-1">
        <Binder
          projectName={state.manifest.name}
          onRenameProject={renameProject}
          items={items}
          docs={docs}
          activeId={active?.id ?? null}
          collapsed={collapsed}
          onToggleFolder={toggleFolder}
          onSelect={navigate}
          newItemParentId={newItemParentId}
          onNewDocument={newDocument}
          onNewFolder={newFolder}
          onAddItem={openAdd}
          onDelete={setConfirmDelete}
          onDuplicate={(id) => void duplicate(id)}
          onQuickRef={setQuickRefId}
          onMove={moveItem}
        />
        <main className="flex min-h-0 min-w-0 flex-1 flex-col bg-surface">
          {mode === 'conflicts' ? (
            <ConflictQueue
              bible={state.bible}
              items={items}
              contentOf={contentOf}
              focusKey={conflictKey}
              onUpdate={updateBible}
              onOpenSource={openSource}
              onOpenEntity={navigate}
            />
          ) : mode === 'timeline' ? (
            <TimelineView bible={state.bible} items={items} onOpenEntity={navigate} onShowConflict={showConflict} />
          ) : splitOpen ? <SplitPane orientation={split!.orientation} first={primaryPane} second={secondaryPane} /> : primaryPane}
        </main>
        {inspected ? (
          <Inspector
            item={inspected}
            content={contentOf(inspected.id)}
            items={items}
            open={inspectorOpen}
            onToggle={() => setInspectorOpen(o => !o)}
            onUpdate={updateItem}
            onNavigate={navigate}
          />
        ) : inspectorOpen && (
          <aside aria-label="Inspector" className="flex w-80 shrink-0 items-center justify-center border-l border-line bg-surface-raised p-6 text-center text-xs text-content-muted">
            Select an item to see its card, notes, sources and links.
          </aside>
        )}
      </div>

      {adding && (
        <AddItemModal
          initialType={adding.type}
          initialParentId={adding.parentId}
          items={items}
          assets={assets}
          importMedia={importMedia}
          discardAsset={discardAsset}
          onCreate={(fields, content) => {
            expand(fields.parentId ?? null);
            navigate(addItem(fields, content));
          }}
          onClose={() => setAdding(null)}
        />
      )}
      {importingChat && (
        <ImportChatModal
          importText={importText}
          onCreate={(fields, text) => {
            expand(importingChat.parentId);
            navigate(addItem({ type: 'chat', parentId: importingChat.parentId, ...fields }, normalizeChatText(text)));
          }}
          onClose={() => setImportingChat(null)}
        />
      )}
      {exporting && (
        <ExportModal
          projectName={state.manifest.name}
          items={items}
          bible={state.bible}
          contentOf={contentOf}
          onExport={exportDossier}
          onClose={() => setExporting(false)}
        />
      )}
      {deleting && (
        <ConfirmDialog
          title="Delete item"
          message={`Delete "${deleting.title || 'Untitled'}"${deletingCount ? ` and the ${deletingCount} ${deletingCount === 1 ? 'item' : 'items'} inside it` : ''}? Files are removed from disk when you save.${factWarning}`}
          confirmLabel="Delete"
          onCancel={() => setConfirmDelete(null)}
          onConfirm={() => {
            deleteItem(deleting.id);
            setConfirmDelete(null);
          }}
        />
      )}
      {quickRef && (
        <QuickRefPanel
          item={quickRef}
          content={contentOf(quickRef.id)}
          assets={assets}
          onOpen={navigate}
          onClose={() => setQuickRefId(null)}
          onOpenLink={openLink}
        />
      )}
    </div>
  );
}
