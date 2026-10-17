import { fieldLabel, input } from '@/components/workspace/ui';

export interface PositionDraft { season: string; episode: string; order: string }

export const emptyPositionDraft = (): PositionDraft => ({ season: '', episode: '', order: '' });

/** Reads a draft into a story position, or null when a part is invalid. */
export function parsePositionDraft(d: PositionDraft): { season: number; episode?: number; order?: number } | null {
  const whole = (s: string): number | null => (/^\d+$/.test(s.trim()) && Number(s) >= 1 ? Number(s) : null);
  const season = whole(d.season);
  if (season === null) return null;
  const out: { season: number; episode?: number; order?: number } = { season };
  if (d.episode.trim() !== '') {
    const episode = whole(d.episode);
    if (episode === null) return null;
    out.episode = episode;
  }
  if (d.order.trim() !== '') {
    const order = Number(d.order);
    if (!Number.isFinite(order)) return null;
    out.order = order;
  }
  return out;
}

export function PositionFields({ value, onChange }: { value: PositionDraft; onChange(v: PositionDraft): void }) {
  const field = (key: keyof PositionDraft, label: string, step: string, min?: string) => (
    <label className="flex flex-col gap-1">
      <span className={fieldLabel}>{label}</span>
      <input
        type="number" aria-label={label} className={`${input} w-20`} step={step} min={min}
        value={value[key]} onChange={(e) => onChange({ ...value, [key]: e.target.value })}
      />
    </label>
  );
  return (
    <div className="flex gap-2">
      {field('season', 'Season', '1', '1')}
      {field('episode', 'Episode', '1', '1')}
      {field('order', 'Order', 'any')}
    </div>
  );
}
