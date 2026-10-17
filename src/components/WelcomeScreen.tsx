import type { RecentProject } from '@/project/types';

interface WelcomeScreenProps {
  recents: RecentProject[];
  available: boolean;
  onCreate(): void;
  onOpen(): void;
  onOpenRecent(root: string): void;
  onRemoveRecent(root: string): void;
}

const buttonClass =
  'rounded-md border border-line bg-surface-raised px-4 py-2 text-sm font-medium hover:border-accent disabled:opacity-50';

export function WelcomeScreen({ recents, available, onCreate, onOpen, onOpenRecent, onRemoveRecent }: WelcomeScreenProps) {
  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-8 px-4 py-16">
      <div className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">Start researching</h2>
        <p className="text-sm text-content-muted">
          A research project is a folder of plain files you can back up, sync, or keep in git.
        </p>
      </div>
      <div className="flex gap-3">
        <button type="button" className={buttonClass} onClick={onCreate} disabled={!available}>
          New project…
        </button>
        <button type="button" className={buttonClass} onClick={onOpen} disabled={!available}>
          Open project…
        </button>
      </div>
      {!available && (
        <p className="text-sm text-content-muted">Projects are only available in the desktop app.</p>
      )}
      {recents.length > 0 && (
        <section aria-labelledby="recent-heading" className="flex flex-col gap-2">
          <h3 id="recent-heading" className="text-xs font-semibold uppercase tracking-wide text-content-muted">
            Recent projects
          </h3>
          <ul className="flex flex-col divide-y divide-line rounded-md border border-line">
            {recents.map((recent) => (
              <li key={recent.root} className="flex items-center gap-2 px-3 py-2">
                <button
                  type="button"
                  className="flex min-w-0 flex-1 flex-col items-start text-left disabled:opacity-60"
                  onClick={() => onOpenRecent(recent.root)}
                  disabled={recent.missing}
                  aria-label={`Open ${recent.name}`}
                >
                  <span className="truncate text-sm font-medium">{recent.name}</span>
                  <span className="w-full truncate text-xs text-content-muted">
                    {recent.missing ? `Not found: ${recent.root}` : recent.root}
                  </span>
                </button>
                <button
                  type="button"
                  className="rounded px-2 py-1 text-xs text-content-muted hover:text-content"
                  onClick={() => onRemoveRecent(recent.root)}
                  aria-label={`Remove ${recent.name} from recent projects`}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
