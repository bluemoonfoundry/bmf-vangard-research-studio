import { FileText, Folder, FolderOpen, Globe, Headphones, Image as ImageIcon, MessageSquare, Shapes } from 'lucide-react';
import type { TreeItem } from '@/project/types';
import { entityKindOf, ENTITY_KINDS } from '@/bible/entities';
import { itemType } from '@/workspace/research';

/** The binder icon for an item's type; folders show open/closed. */
export function ItemIcon({ item, open = false, className = 'h-4 w-4' }: { item: Pick<TreeItem, 'type' | 'entityKind'>; open?: boolean; className?: string }) {
  const props = { className: `${className} shrink-0`, 'aria-hidden': true };
  switch (itemType(item)) {
    case 'folder':
      return open ? <FolderOpen {...props} /> : <Folder {...props} />;
    case 'image':
      return <ImageIcon {...props} />;
    case 'webpage':
      return <Globe {...props} />;
    case 'audio':
      return <Headphones {...props} />;
    case 'chat':
      return <MessageSquare {...props} />;
    case 'entity': {
      const kind = entityKindOf(item);
      const Icon = ENTITY_KINDS.find(k => k.id === kind)?.icon ?? Shapes;
      return <Icon {...props} />;
    }
    default:
      return <FileText {...props} />;
  }
}
