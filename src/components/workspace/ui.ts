/** Shared class strings so controls look the same across the workspace. */

export const btn =
  'inline-flex items-center gap-1.5 rounded border border-line bg-surface-raised px-2.5 py-1 text-xs text-content ' +
  'hover:border-accent disabled:opacity-50 disabled:hover:border-line';

export const btnPrimary =
  'inline-flex items-center gap-1.5 rounded bg-accent px-3 py-1 text-xs font-semibold text-on-accent ' +
  'hover:opacity-90 disabled:opacity-50';

export const btnGhost =
  'inline-flex items-center gap-1 rounded p-1 text-content-muted hover:bg-surface-sunken hover:text-content ' +
  'disabled:opacity-40';

export const input =
  'rounded border border-line bg-surface-raised px-2 py-1 text-xs text-content placeholder:text-content-muted ' +
  'focus:border-accent focus:outline-none';

export const fieldLabel = 'text-[11px] font-medium uppercase tracking-wider text-content-muted';

/** A segmented toggle button; `active` marks the selected segment. */
export const segment = (active: boolean) =>
  `inline-flex items-center gap-1.5 rounded px-2.5 py-1 text-xs transition-colors ${
    active ? 'bg-accent font-semibold text-on-accent' : 'text-content-muted hover:text-content'
  }`;

export const segmentGroup = 'inline-flex items-center gap-0.5 rounded-md border border-line bg-surface-sunken p-0.5';
