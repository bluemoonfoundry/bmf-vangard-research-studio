import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

export interface ContextMenuEntry {
  label: string;
  icon?: ReactNode;
  danger?: boolean;
  onSelect(): void;
}

export interface ContextMenuProps {
  /** Accessible name, e.g. "Actions for Notes". */
  label: string;
  /** Viewport point the menu opens at; it's nudged back on screen if it would overflow. */
  x: number;
  y: number;
  entries: ContextMenuEntry[];
  /** Called on Escape, Tab, a pointer press outside, or after an entry runs. */
  onClose(): void;
}

const MARGIN = 4;

/**
 * A right-click menu (WAI-ARIA menu pattern): focus starts on the first entry, the arrows, Home and
 * End move it, Enter or a click runs an entry. Rendered in a portal so a scrolling panel can't clip it.
 * The opener restores focus to wherever the menu came from.
 */
export function ContextMenu({ label, x, y, entries, onClose }: ContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    setPos({
      left: Math.max(MARGIN, Math.min(x, window.innerWidth - width - MARGIN)),
      top: Math.max(MARGIN, Math.min(y, window.innerHeight - height - MARGIN)),
    });
    el.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
  }, [x, y]);

  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const onBlur = () => onClose();
    document.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('blur', onBlur);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('blur', onBlur);
    };
  }, [onClose]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    const items = [...(ref.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
    const at = items.indexOf(document.activeElement as HTMLElement);
    const move = (i: number) => items[(i + items.length) % items.length]?.focus();
    switch (e.key) {
      case 'ArrowDown': e.preventDefault(); move(at + 1); break;
      case 'ArrowUp': e.preventDefault(); move(at - 1); break;
      case 'Home': e.preventDefault(); move(0); break;
      case 'End': e.preventDefault(); move(items.length - 1); break;
      case 'Escape':
      case 'Tab':
        e.preventDefault();
        onClose();
        break;
    }
  };

  return createPortal(
    <div
      ref={ref}
      role="menu"
      aria-label={label}
      tabIndex={-1}
      onKeyDown={onKeyDown}
      onContextMenu={(e) => e.preventDefault()}
      className="fixed z-50 min-w-44 rounded border border-line bg-surface-raised py-1 text-xs shadow-lg"
      style={pos}
    >
      {entries.map(entry => (
        <button
          key={entry.label}
          type="button"
          role="menuitem"
          tabIndex={-1}
          className={`flex w-full items-center gap-2 px-3 py-1.5 text-left outline-none hover:bg-surface-sunken focus:bg-surface-sunken ${
            entry.danger ? 'text-danger' : 'text-content'
          }`}
          onClick={() => {
            onClose();
            entry.onSelect();
          }}
        >
          <span className="flex h-3.5 w-3.5 shrink-0 items-center text-content-muted">{entry.icon}</span>
          {entry.label}
        </button>
      ))}
    </div>,
    document.body,
  );
}
