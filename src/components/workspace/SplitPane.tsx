import { useRef, useState, type ReactNode } from 'react';

export type SplitOrientation = 'vertical' | 'horizontal';

interface SplitPaneProps {
  /** vertical = side by side, horizontal = stacked. */
  orientation: SplitOrientation;
  first: ReactNode;
  second: ReactNode;
}

const MIN = 0.2;
const MAX = 0.8;
const clamp = (v: number) => Math.min(MAX, Math.max(MIN, v));

/** Two panes with a draggable (and keyboard-adjustable) divider between them. */
export function SplitPane({ orientation, first, second }: SplitPaneProps) {
  const [ratio, setRatio] = useState(0.5);
  const container = useRef<HTMLDivElement>(null);
  const vertical = orientation === 'vertical';

  const ratioAt = (e: React.PointerEvent) => {
    const rect = container.current!.getBoundingClientRect();
    return clamp(vertical ? (e.clientX - rect.left) / rect.width : (e.clientY - rect.top) / rect.height);
  };

  const step = (delta: number) => setRatio(r => clamp(r + delta));

  return (
    <div ref={container} className={`flex min-h-0 min-w-0 flex-1 ${vertical ? 'flex-row' : 'flex-col'}`}>
      <div className="flex min-h-0 min-w-0 flex-col overflow-hidden" style={{ flexBasis: `${ratio * 100}%` }}>{first}</div>
      <div
        role="separator"
        tabIndex={0}
        aria-label="Resize split"
        // A vertical split has a vertical divider bar.
        aria-orientation={vertical ? 'vertical' : 'horizontal'}
        aria-valuemin={MIN * 100}
        aria-valuemax={MAX * 100}
        aria-valuenow={Math.round(ratio * 100)}
        onPointerDown={(e) => {
          e.preventDefault();
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (e.currentTarget.hasPointerCapture(e.pointerId)) setRatio(ratioAt(e));
        }}
        onPointerUp={(e) => e.currentTarget.releasePointerCapture(e.pointerId)}
        onDoubleClick={() => setRatio(0.5)}
        onKeyDown={(e) => {
          const back = vertical ? 'ArrowLeft' : 'ArrowUp';
          const forward = vertical ? 'ArrowRight' : 'ArrowDown';
          if (e.key === back) step(-0.05);
          else if (e.key === forward) step(0.05);
          else if (e.key === 'Home') setRatio(MIN);
          else if (e.key === 'End') setRatio(MAX);
          else return;
          e.preventDefault();
        }}
        className={`shrink-0 bg-line outline-none hover:bg-accent focus-visible:bg-accent ${
          vertical ? 'w-1 cursor-col-resize' : 'h-1 cursor-row-resize'
        }`}
      />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">{second}</div>
    </div>
  );
}
