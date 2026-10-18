import type { Bible, FactSource, StoryPosition, TreeItem } from '@/project/types';
import type { Version } from '@/bible/contradictions';
import type { ChatOf } from '@/chat/buildChatRequest';
import { checkPosition } from '@/bible/ordering';
import { formatPosition } from '@/bible/normalize';
import { resolveSource, sourceText } from '@/bible/sources';
import { SourceLink } from '@/components/bible/SourceLink';
import { btnPrimary } from '@/components/workspace/ui';

export interface VersionCardProps {
  version: Version;
  /** Set for a `when` contradiction on an event: the position is checked against its dependencies. */
  checkEventId?: string;
  bible: Bible;
  byId: ReadonlyMap<string, TreeItem>;
  contentOf(id: string): string | undefined;
  chatOf: ChatOf;
  onKeep(): void;
  onOpenSource(source: FactSource): void;
}

const MARK = { ok: '✓', violated: '✗ must come', unknown: '?' } as const;

export function VersionCard({ version, checkEventId, bible, byId, contentOf, chatOf, onKeep, onOpenSource }: VersionCardProps) {
  const { value } = version;
  const text = typeof value === 'string' ? value : formatPosition(value);
  const checks = checkEventId && typeof value === 'object'
    ? checkPosition(bible, checkEventId, value as StoryPosition)
    : [];
  const sources = version.facts.flatMap(f => (f.source ? [f.source] : []));

  return (
    <article className="flex flex-col gap-2 rounded border border-line bg-surface-raised p-3 text-xs">
      <p className="text-sm font-semibold">{text}</p>
      {sources.map((s, i) => {
        const item = byId.get(s.itemId);
        return (
          <SourceLink
            key={`${s.itemId}:${s.messageId ?? ''}:${s.start}:${i}`}
            source={s}
            state={resolveSource(s, sourceText(s, contentOf, chatOf), item !== undefined)}
            title={item?.title}
            onOpen={() => onOpenSource(s)}
          />
        );
      })}
      {checks.length > 0 && (
        <ul className="flex flex-col gap-0.5">
          {checks.map(c => {
            const other = byId.get(c.otherEventId)?.title || 'Untitled';
            return (
              <li key={c.dependencyId} className={c.result === 'violated' ? 'text-danger' : 'text-content-muted'}>
                {MARK[c.result]} {c.direction} {other}
              </li>
            );
          })}
        </ul>
      )}
      <button type="button" className={`${btnPrimary} self-start`} onClick={onKeep}>Keep this one</button>
    </article>
  );
}
