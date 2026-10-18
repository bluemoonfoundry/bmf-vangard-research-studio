import type { FactSource } from '@/project/types';
import type { SourceState } from '@/bible/sources';

export interface SourceLinkProps {
  source: FactSource;
  state: SourceState;
  /** Title of the source item, when it still exists. */
  title?: string;
  onOpen(): void;
}

/** The quote a fact was taken from, and a way back to where it came from. */
export function SourceLink({ source, state, title, onOpen }: SourceLinkProps) {
  return (
    <div className="flex flex-col gap-0.5 text-[11px] text-content-muted">
      <q className="italic">{source.quote}</q>
      {state.status === 'deleted' ? (
        <span>source deleted</span>
      ) : (
        <span className="flex flex-wrap items-center gap-1.5">
          <button type="button" className="text-accent hover:underline" onClick={onOpen}>
            {title || 'Untitled'}
          </button>
          {state.status === 'missing' && <span>{state.reason === 'message_deleted' ? 'message was deleted' : 'passage no longer found'}</span>}
        </span>
      )}
    </div>
  );
}
