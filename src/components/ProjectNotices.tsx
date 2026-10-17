import type { ReactNode } from 'react';
import { STRUCTURE_CONFLICT, type ProjectController } from '@/project/useProject';

function Notice({ tone, children }: { tone: 'info' | 'warning' | 'error'; children: ReactNode }) {
  const border = tone === 'info' ? 'border-line' : 'border-accent';
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={`flex flex-wrap items-center gap-3 border-b ${border} bg-surface-raised px-4 py-2 text-sm`}
    >
      {children}
    </div>
  );
}

const actionClass = 'rounded border border-line px-2 py-0.5 text-xs hover:border-accent';

function conflictLabel(conflict: string, project: ProjectController) {
  if (conflict === STRUCTURE_CONFLICT) return 'The project structure';
  const id = /^docs\/(.+)\.md$/.exec(conflict)?.[1];
  const title = project.state?.tree.items.find(i => i.id === id)?.title;
  return title ? `"${title}"` : conflict;
}

/** Banners for errors, migrations, crash recovery and external edits. */
export function ProjectNotices({ project }: { project: ProjectController }) {
  const { error, migratedFrom, recovery, conflicts } = project;
  return (
    <>
      {error && (
        <Notice tone="error">
          <span className="flex-1">{error}</span>
          <button type="button" className={actionClass} onClick={project.dismissError}>Dismiss</button>
        </Notice>
      )}
      {migratedFrom !== null && (
        <Notice tone="info">
          <span className="flex-1">
            This project was upgraded from an older format. The original files were kept as <code>*.v{migratedFrom}.bak</code>.
          </span>
          <button type="button" className={actionClass} onClick={project.dismissMigration}>OK</button>
        </Notice>
      )}
      {recovery && (
        <Notice tone="warning">
          <span className="flex-1">
            Unsaved changes from {new Date(recovery.savedAt).toLocaleString()} were recovered.
          </span>
          <button type="button" className={actionClass} onClick={() => void project.restoreRecovery()}>Restore</button>
          <button type="button" className={actionClass} onClick={() => void project.discardRecovery()}>Discard</button>
        </Notice>
      )}
      {conflicts.map((conflict) => (
        <Notice key={conflict} tone="warning">
          <span className="flex-1">
            {conflictLabel(conflict, project)} changed on disk while you had unsaved changes.
          </span>
          <button type="button" className={actionClass} onClick={() => void project.reloadFromDisk(conflict)}>
            Reload from disk
          </button>
          <button type="button" className={actionClass} onClick={() => void project.keepMine(conflict)}>
            Keep my version
          </button>
        </Notice>
      ))}
    </>
  );
}
