import { useEffect, useMemo, useState } from 'react';
import { createProjectApi } from '@/project/api';
import { useProject } from '@/project/useProject';
import { WelcomeScreen } from '@/components/WelcomeScreen';
import { Workspace } from '@/components/workspace/Workspace';
import { ProjectNotices } from '@/components/ProjectNotices';
import { SettingsDialog } from '@/components/settings/SettingsDialog';
import { createAiApi } from '@/ai/aiApi';
import { useAi } from '@/ai/useAi';
import { Settings } from 'lucide-react';

const APP_NAME = 'Vangard Research Studio';
const headerButton = 'rounded border border-line px-2 py-1 text-xs hover:border-accent disabled:opacity-50';

export default function App() {
  const [version, setVersion] = useState<string | null>(null);
  const bridge = window.vrs;
  const api = useMemo(() => (bridge ? createProjectApi(bridge) : null), [bridge]);
  const project = useProject(api, bridge?.app ?? null);
  const aiApi = useMemo(() => (bridge?.ai ? createAiApi(bridge) : null), [bridge]);
  const ai = useAi(aiApi);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const { state, dirty, saving, save } = project;
  const projectName = state?.manifest.name;

  useEffect(() => {
    let cancelled = false;
    window.vrs?.app.getVersion().then((v) => {
      if (!cancelled) setVersion(v);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    document.title = projectName ? `${dirty ? '● ' : ''}${projectName} — ${APP_NAME}` : APP_NAME;
  }, [projectName, dirty]);

  useEffect(() => {
    if (!state) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void save();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [state, save]);

  return (
    <div className="flex h-screen flex-col bg-surface text-content">
      <header className="flex h-12 shrink-0 items-center gap-4 border-b border-line px-4">
        <h1 className="text-sm font-semibold tracking-tight">{APP_NAME}</h1>
        {state && (
          <>
            <span className="truncate text-sm text-content-muted" title={state.root}>{state.manifest.name}</span>
            <span className="text-xs text-content-muted" aria-live="polite">
              {saving ? 'Saving…' : dirty ? 'Unsaved changes' : 'Saved'}
            </span>
            <div className="ml-auto flex gap-2">
              <button type="button" className={headerButton} onClick={() => void save()} disabled={!dirty || saving}>
                Save
              </button>
              <button type="button" className={headerButton} onClick={() => void project.closeProject()}>
                Close project
              </button>
            </div>
          </>
        )}
        {version && <span className={`text-xs text-content-muted ${state ? '' : 'ml-auto'}`}>v{version}</span>}
        <button type="button" className={`${headerButton} inline-flex items-center`} aria-label="Settings" title="Settings" onClick={() => setSettingsOpen(true)}>
          <Settings className="h-4 w-4" />
        </button>
      </header>
      <ProjectNotices project={project} />
      <main className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
        {state ? (
          <Workspace key={state.root} project={project} />
        ) : (
          <WelcomeScreen
            recents={project.recents}
            available={api !== null}
            onCreate={() => void project.createProject()}
            onOpen={() => void project.openProject()}
            onOpenRecent={(root) => void project.openRecent(root)}
            onRemoveRecent={(root) => void project.removeRecent(root)}
          />
        )}
      </main>
      {settingsOpen && <SettingsDialog ai={ai} onClose={() => setSettingsOpen(false)} />}
    </div>
  );
}
