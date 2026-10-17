import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import type { Bible, EntityKind, FactSource, TreeItem } from '@/project/types';
import { addFact } from '@/bible/ops';
import { attributeSuggestions } from '@/bible/entities';
import { FactForm, type FactFormProps, type FactFormValue } from '@/components/bible/FactForm';

export interface CapturePopoverProps extends Omit<FactFormProps, 'source' | 'onCancel' | 'fixedEntityId' | 'initial'> {
  anchor: DOMRect;
  source: FactSource;
  onCancel(): void;
}

const WIDTH = 320;

/** A fact form floating at the selected passage. Escape and outside clicks cancel. */
export function CapturePopover({ anchor, source, onCancel, ...form }: CapturePopoverProps) {
  const box = useRef<HTMLDivElement>(null);
  const cancel = useRef(onCancel);
  cancel.current = onCancel;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') cancel.current(); };
    const onDown = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) cancel.current();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDown);
    };
  }, []);

  const left = Math.max(8, Math.min(anchor.left, window.innerWidth - WIDTH - 8));
  const top = Math.min(anchor.bottom + 8, Math.max(8, window.innerHeight - 320));

  return createPortal(
    <div
      ref={box} role="dialog" aria-label="Capture fact"
      className="fixed z-50 shadow-lg" style={{ left, top, width: WIDTH }}
    >
      <FactForm {...form} source={source} onCancel={onCancel} />
    </div>,
    document.body,
  );
}

export interface CaptureSelection { start: number; end: number; quote: string; anchor: DOMRect }

export interface CaptureHostProps {
  itemId: string;
  /** A new entity is created under this parent, beside the captured item. */
  parentId: string | null;
  items: TreeItem[];
  bible: Bible;
  updateBible(update: (b: Bible) => Bible): void;
  addEntity(kind: EntityKind, title: string, parentId: string | null): string;
  selection: CaptureSelection | null;
  onClose(): void;
}

/** Shows the capture popover for a selection and turns its submission into a kept, manual fact. */
export function CaptureHost({ itemId, parentId, items, bible, updateBible, addEntity, selection, onClose }: CaptureHostProps) {
  if (!selection) return null;
  const { start, end, quote, anchor } = selection;
  const source: FactSource = { itemId, quote, start, end };

  const submit = (v: FactFormValue) => {
    const entityId = v.newEntity ? addEntity(v.newEntity.kind, v.newEntity.title, parentId) : v.entityId;
    if (!entityId) return;
    const at = new Date().toISOString();
    updateBible(b => addFact(b, {
      id: crypto.randomUUID(), entityId, attribute: v.attribute, value: v.value,
      status: 'kept', origin: 'manual', source, createdAt: at, updatedAt: at,
    }));
    onClose();
  };

  return (
    <CapturePopover
      anchor={anchor}
      source={source}
      entities={items.filter(i => i.type === 'entity')}
      attributeSuggestions={(kind) => attributeSuggestions(bible, items, kind)}
      onSubmit={submit}
      onCancel={onClose}
    />
  );
}
