import { Fragment } from 'react';
import { Users } from 'lucide-react';
import type { TreeItem } from '@/project/types';
import { entityKindOf } from '@/bible/entities';
import { sharedNames } from '@/bible/names';

/** "Shares "Smith" with Ben Smith" lines for a character; the names open the other card when `onOpen` is given. */
export function SharedNames({ entity, items, onOpen }: { entity: TreeItem; items: readonly TreeItem[]; onOpen?(id: string): void }) {
  if (entityKindOf(entity) !== 'character') return null;
  const shared = sharedNames(entity.title, items, entity.id);
  if (shared.length === 0) return null;
  return (
    <ul aria-label="Shared names" className="flex flex-col gap-0.5 text-xs text-content-muted">
      {shared.map(s => (
        <li key={s.part} className="flex items-baseline gap-1">
          <Users className="h-3 w-3 shrink-0 self-center" aria-hidden />
          <span>
            {`Shares "${s.part}" with `}
            {s.others.map((o, i) => (
              <Fragment key={o.id}>
                {i > 0 && ', '}
                {onOpen
                  ? <button type="button" className="text-accent hover:underline" onClick={() => onOpen(o.id)}>{o.title || 'Untitled'}</button>
                  : o.title || 'Untitled'}
              </Fragment>
            ))}
          </span>
        </li>
      ))}
    </ul>
  );
}
