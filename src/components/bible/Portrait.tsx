import { FileQuestion } from 'lucide-react';
import type { TreeItem } from '@/project/types';
import type { AssetCache } from '@/workspace/assetCache';
import { ENTITY_KINDS, entityKindOf } from '@/bible/entities';
import { useAssetUrl } from '@/workspace/useAssetUrl';

const SIZE = { sm: 'h-12 w-12', lg: 'h-24 w-24' } as const;

/** An entity's portrait image, or its kind's icon while there is none (or it hasn't loaded). */
export function Portrait({ entity, image, assets, size }: {
  entity: TreeItem; image: TreeItem | undefined; assets: AssetCache | null; size: keyof typeof SIZE;
}) {
  const state = useAssetUrl(assets, image?.asset);
  const kind = entityKindOf(entity);
  const Icon = ENTITY_KINDS.find(k => k.id === kind)?.icon ?? FileQuestion;
  return (
    <span className={`flex shrink-0 items-center justify-center overflow-hidden rounded-md border border-line bg-surface-sunken ${SIZE[size]}`}>
      {state.status === 'ready'
        ? <img src={state.url} alt={image?.mediaAlt || image?.title || ''} className="h-full w-full object-cover" />
        : <Icon className="h-1/2 w-1/2 text-content-muted" aria-hidden />}
    </span>
  );
}
