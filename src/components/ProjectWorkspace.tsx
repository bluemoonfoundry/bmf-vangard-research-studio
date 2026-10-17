import { useEffect, useMemo, useState } from 'react';
import { isDocDirty } from '@/project/projectState';
import type { ProjectController } from '@/project/useProject';

/**
 * A minimal document list + plain-text editor that exercises project storage.
 * Phase 2 replaces it with the ported binder, editor and inspector.
 */
export function ProjectWorkspace({ project }: { project: ProjectController }) {
  const state = project.state!;
  const { loadDoc } = project;
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const documents = useMemo(
    () => state.tree.items.filter(i => i.type === 'document').sort((a, b) => a.order - b.order),
    [state.tree.items],
  );
  const selected = documents.find(d => d.id === selectedId) ?? null;
  const doc = selected ? state.docs[selected.id] : undefined;

  useEffect(() => {
    if (selected) void loadDoc(selected.id);
  }, [selected, loadDoc]);

  const addDocument = () => setSelectedId(project.addDocument('Untitled document'));

  const deleteSelected = () => {
    if (!selected) return;
    if (!window.confirm(`Delete "${selected.title}"? This takes effect when you save.`)) return;
    project.deleteItem(selected.id);
    setSelectedId(null);
  };

  return (
    <div className="flex min-h-0 flex-1">
      <aside className="flex w-64 shrink-0 flex-col gap-3 border-r border-line p-3">
        <label className="flex flex-col gap-1 text-xs text-content-muted">
          Project name
          <input
            className="rounded border border-line bg-surface-raised px-2 py-1 text-sm text-content"
            value={state.manifest.name}
            onChange={(e) => project.renameProject(e.target.value)}
          />
        </label>
        <div className="flex items-center justify-between">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-content-muted">Documents</h2>
          <button type="button" className="text-xs text-accent hover:underline" onClick={addDocument}>
            New document
          </button>
        </div>
        <ul className="flex flex-col gap-0.5 overflow-y-auto" aria-label="Documents">
          {documents.map((d) => (
            <li key={d.id}>
              <button
                type="button"
                aria-current={d.id === selectedId ? 'true' : undefined}
                className={`flex w-full items-center justify-between rounded px-2 py-1 text-left text-sm ${
                  d.id === selectedId ? 'bg-surface-raised text-content' : 'text-content-muted hover:text-content'
                }`}
                onClick={() => setSelectedId(d.id)}
              >
                <span className="truncate">{d.title || 'Untitled'}</span>
                {isDocDirty(state, d.id) && <span aria-label="unsaved" className="text-accent">●</span>}
              </button>
            </li>
          ))}
          {documents.length === 0 && <li className="px-2 text-sm text-content-muted">No documents yet.</li>}
        </ul>
      </aside>
      <section className="flex min-w-0 flex-1 flex-col gap-3 p-4">
        {!selected && <p className="m-auto text-sm text-content-muted">Select or create a document.</p>}
        {selected && (
          <>
            <div className="flex items-center gap-2">
              <input
                aria-label="Document title"
                className="flex-1 rounded border border-line bg-surface-raised px-2 py-1 text-base font-medium"
                value={selected.title}
                onChange={(e) => project.renameItem(selected.id, e.target.value)}
              />
              <button type="button" className="text-xs text-content-muted hover:text-content" onClick={deleteSelected}>
                Delete
              </button>
            </div>
            {doc ? (
              <textarea
                aria-label="Document text"
                className="flex-1 resize-none rounded border border-line bg-surface-raised p-3 font-mono text-sm"
                value={doc.current}
                onChange={(e) => project.editDoc(selected.id, e.target.value)}
              />
            ) : (
              <p className="text-sm text-content-muted">Loading…</p>
            )}
          </>
        )}
      </section>
    </div>
  );
}
