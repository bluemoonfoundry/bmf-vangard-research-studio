import { useId, useState } from 'react';
import { CheckCircle2, ChevronLeft, ChevronRight, Link2, Plus, Target, Trash2, X } from 'lucide-react';
import type { Citation, LabelId, StatusId, TreeItem } from '@/project/types';
import { LABEL_LIST, NO_LABEL_COLOR, STATUS_LIST, itemType, labelOf } from '@/workspace/research';
import { textStats } from '@/workspace/stats';
import { isSourceItem } from '@/bible/sourceOrder';
import { btn, btnGhost, btnPrimary, fieldLabel, input, segment, segmentGroup } from '@/components/workspace/ui';

type Tab = 'card' | 'notes' | 'metadata' | 'links';

const TABS: { id: Tab; name: string }[] = [
  { id: 'card', name: 'Card' },
  { id: 'notes', name: 'Notes' },
  { id: 'metadata', name: 'Metadata' },
  { id: 'links', name: 'Links' },
];

const GOAL_PRESETS = [250, 500, 1000, 2500, 5000];

export interface InspectorProps {
  item: TreeItem;
  content: string | undefined;
  items: TreeItem[];
  open: boolean;
  onToggle(): void;
  onUpdate(id: string, patch: Partial<TreeItem>): void;
  onNavigate(id: string): void;
  /** Shows AI-only settings ("This is my own writing" on sources). */
  aiEnabled?: boolean;
}

const newId = () => crypto.randomUUID();

export function Inspector({ item, content, items, open, onToggle, onUpdate, onNavigate, aiEnabled = false }: InspectorProps) {
  const [tab, setTab] = useState<Tab>('card');
  const tabsId = useId();
  const stats = textStats(content ?? '');

  if (!open) {
    return (
      <aside aria-label="Inspector" className="flex w-10 shrink-0 flex-col items-center gap-6 border-l border-line bg-surface-raised py-3">
        <button type="button" className={btnGhost} onClick={onToggle} aria-label="Show inspector" title="Show inspector (Ctrl+I)">
          <ChevronLeft className="h-4 w-4" />
        </button>
        <span className="-rotate-90 whitespace-nowrap text-[10px] font-semibold tracking-wider text-content-muted">INSPECTOR</span>
        <span className="mt-auto -rotate-90 whitespace-nowrap font-mono text-[10px] text-content-muted">{stats.words}w</span>
      </aside>
    );
  }

  const update = (patch: Partial<TreeItem>) => onUpdate(item.id, patch);

  return (
    <aside aria-label="Inspector" className="flex w-80 shrink-0 flex-col border-l border-line bg-surface-raised">
      <div className="flex items-center justify-between gap-2 border-b border-line p-2">
        <div className={segmentGroup} role="tablist" aria-label="Inspector sections">
          {TABS.map(t => (
            <button
              key={t.id}
              type="button"
              role="tab"
              id={`${tabsId}-${t.id}`}
              aria-selected={tab === t.id}
              aria-controls={`${tabsId}-panel`}
              className={segment(tab === t.id)}
              onClick={() => setTab(t.id)}
            >
              {t.name}{t.id === 'links' && item.references?.length ? ` (${item.references.length})` : ''}
            </button>
          ))}
        </div>
        <button type="button" className={btnGhost} onClick={onToggle} aria-label="Hide inspector" title="Hide inspector (Ctrl+I)">
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      <WritingProgress item={item} words={stats.words} onUpdate={update} />

      <div id={`${tabsId}-panel`} role="tabpanel" aria-labelledby={`${tabsId}-${tab}`} className="flex-1 overflow-y-auto p-3 text-xs">
        {tab === 'card' && <CardTab item={item} onUpdate={update} />}
        {tab === 'card' && aiEnabled && isSourceItem(item) && (
          <label className="mt-4 flex items-start gap-2" title="AI extraction treats a source without turns as model output unless it is your own writing.">
            <input type="checkbox" aria-label="This is my own writing" checked={item.ownWriting === true} onChange={(e) => update({ ownWriting: e.target.checked })} />
            <span className="flex flex-col">
              <span>This is my own writing</span>
              <span className="text-content-muted">AI extraction proposes what it says as yours, not as suggestions.</span>
            </span>
          </label>
        )}
        {tab === 'notes' && (
          <label className="flex flex-col gap-1.5">
            <span className={fieldLabel}>Document notes</span>
            <textarea
              aria-label="Document notes"
              rows={14}
              value={item.documentNotes ?? ''}
              onChange={(e) => update({ documentNotes: e.target.value })}
              placeholder="Questions to verify, discrepancies, ideas this research suggests…"
              className={`${input} resize-none leading-relaxed`}
            />
          </label>
        )}
        {tab === 'metadata' && <MetadataTab item={item} stats={stats} onUpdate={update} />}
        {tab === 'links' && <LinksTab item={item} items={items} onUpdate={update} onNavigate={onNavigate} />}
      </div>
    </aside>
  );
}

function WritingProgress({ item, words, onUpdate }: { item: TreeItem; words: number; onUpdate(patch: Partial<TreeItem>): void }) {
  const [editing, setEditing] = useState(false);
  const [custom, setCustom] = useState('');
  const target = item.targetWordCount ?? 0;
  const percent = target > 0 ? Math.min(100, Math.round((words / target) * 100)) : 0;
  const reached = target > 0 && words >= target;

  const setGoal = (value: number | undefined) => {
    onUpdate({ targetWordCount: value });
    setEditing(false);
    setCustom('');
  };

  return (
    <div className="border-b border-line bg-surface-sunken px-3 py-2 text-xs">
      <div className="flex items-center justify-between">
        <span><span className="font-mono text-base font-bold tabular-nums">{words.toLocaleString()}</span> <span className="text-xs text-content-muted">words</span></span>
        <button type="button" className={`${btnGhost} text-[11px]`} aria-expanded={editing} onClick={() => setEditing(e => !e)}>
          <Target className="h-3.5 w-3.5" />
          {target > 0 ? `Goal ${target.toLocaleString()}` : 'Set goal'}
        </button>
      </div>
      {target > 0 && (
        <div className="mt-1.5 flex flex-col gap-1">
          <div
            className="h-1.5 overflow-hidden rounded-full bg-surface-raised"
            role="progressbar"
            aria-label="Word goal progress"
            aria-valuenow={percent}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <div className="h-full rounded-full bg-accent transition-[width]" style={{ width: `${percent}%` }} />
          </div>
          <span className="flex items-center gap-1 text-[11px] text-content-muted">
            {reached && <CheckCircle2 className="h-3 w-3 text-accent" aria-hidden />}
            {reached ? `Goal reached (+${(words - target).toLocaleString()})` : `${(target - words).toLocaleString()} to go · ${percent}%`}
          </span>
        </div>
      )}
      {editing && (
        <div className="mt-2 flex flex-col gap-2 rounded border border-line bg-surface-raised p-2">
          <div className="flex flex-wrap gap-1">
            {GOAL_PRESETS.map(p => (
              <button key={p} type="button" className={segment(target === p)} onClick={() => setGoal(p)}>{p}</button>
            ))}
            {target > 0 && <button type="button" className={segment(false)} onClick={() => setGoal(undefined)}>Clear</button>}
          </div>
          <form
            className="flex gap-1"
            onSubmit={(e) => {
              e.preventDefault();
              const value = Number.parseInt(custom, 10);
              if (value > 0) setGoal(value);
            }}
          >
            <input
              type="number"
              min={1}
              aria-label="Custom word goal"
              className={`${input} flex-1`}
              value={custom}
              onChange={(e) => setCustom(e.target.value)}
              placeholder="Custom goal"
            />
            <button type="submit" className={btn}>Set</button>
          </form>
        </div>
      )}
    </div>
  );
}

function CardTab({ item, onUpdate }: { item: TreeItem; onUpdate(patch: Partial<TreeItem>): void }) {
  const label = labelOf(item);
  return (
    <div className="flex flex-col gap-4">
      <div className="overflow-hidden rounded-md border border-card-line bg-card text-card-content shadow-sm">
        <div className="h-2" style={{ backgroundColor: label?.color ?? NO_LABEL_COLOR }} />
        <div className="p-2.5">
          <div className="mb-1 border-b border-card-line pb-1 font-serif text-xs font-bold">{item.title || 'Untitled'}</div>
          <textarea
            aria-label="Index card synopsis"
            rows={6}
            value={item.synopsis ?? ''}
            onChange={(e) => onUpdate({ synopsis: e.target.value })}
            placeholder="Index card synopsis…"
            className="w-full resize-none bg-transparent text-xs leading-relaxed placeholder:text-card-muted focus:outline-none"
          />
        </div>
      </div>
      <LabelStatusFields item={item} onUpdate={onUpdate} />
    </div>
  );
}

/** Label and status pickers, shared by the inspector and the outliner's column editors. */
export function LabelStatusFields({ item, onUpdate }: { item: TreeItem; onUpdate(patch: Partial<TreeItem>): void }) {
  return (
    <>
      <label className="flex flex-col gap-1">
        <span className={fieldLabel}>Label</span>
        <select
          className={input}
          value={item.label ?? ''}
          onChange={(e) => onUpdate({ label: (e.target.value || null) as LabelId | null })}
        >
          <option value="">No label</option>
          {LABEL_LIST.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
        </select>
      </label>
      <label className="flex flex-col gap-1">
        <span className={fieldLabel}>Status</span>
        <select
          className={input}
          value={item.status ?? ''}
          onChange={(e) => onUpdate({ status: (e.target.value || null) as StatusId | null })}
        >
          <option value="">No status</option>
          {STATUS_LIST.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
        </select>
      </label>
    </>
  );
}

function MetadataTab({ item, stats, onUpdate }: { item: TreeItem; stats: ReturnType<typeof textStats>; onUpdate(patch: Partial<TreeItem>): void }) {
  const [tag, setTag] = useState('');
  const [adding, setAdding] = useState(false);
  const type = itemType(item);

  const addTag = () => {
    const value = tag.trim();
    if (value && !item.keywords.includes(value)) onUpdate({ keywords: [...item.keywords, value] });
    setTag('');
  };

  const date = (iso?: string) => (iso ? new Date(iso).toLocaleString() : '—');

  return (
    <div className="flex flex-col gap-5">
      <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 rounded border border-line bg-surface-sunken p-2.5 text-[11px]">
        <dt className="text-content-muted">Words</dt><dd className="text-right font-mono">{stats.words.toLocaleString()}</dd>
        <dt className="text-content-muted">Characters</dt><dd className="text-right font-mono">{stats.chars.toLocaleString()}</dd>
        <dt className="text-content-muted">Without spaces</dt><dd className="text-right font-mono">{stats.charsNoSpaces.toLocaleString()}</dd>
        <dt className="text-content-muted">Paragraphs · lines</dt><dd className="text-right font-mono">{stats.paragraphs} · {stats.lines}</dd>
        <dt className="text-content-muted">Reading time</dt><dd className="text-right font-mono">~{stats.readingMinutes} min</dd>
        <dt className="text-content-muted">Created</dt><dd className="text-right font-mono">{date(item.createdAt)}</dd>
        <dt className="text-content-muted">Modified</dt><dd className="text-right font-mono">{date(item.updatedAt)}</dd>
      </dl>

      {(type === 'webpage' || type === 'image' || type === 'audio') && (
        <fieldset className="flex flex-col gap-2">
          <legend className={`${fieldLabel} mb-1.5`}>Source</legend>
          {type === 'webpage' && (
            <input aria-label="Source URL" className={input} value={item.url ?? ''} placeholder="https://…" onChange={(e) => onUpdate({ url: e.target.value })} />
          )}
          {type === 'image' && (
            <input aria-label="Image description" className={input} value={item.mediaAlt ?? ''} placeholder="Describe the image (alt text)" onChange={(e) => onUpdate({ mediaAlt: e.target.value })} />
          )}
          {(['author', 'sourceDomain', 'year', 'archivalRefNumber'] as const).map(field => (
            <input
              key={field}
              aria-label={{ author: 'Author', sourceDomain: 'Publisher or archive', year: 'Year', archivalRefNumber: 'Reference number' }[field]}
              placeholder={{ author: 'Author', sourceDomain: 'Publisher or archive', year: 'Year', archivalRefNumber: 'Reference number' }[field]}
              className={input}
              value={item.mediaMetadata?.[field] ?? ''}
              onChange={(e) => onUpdate({ mediaMetadata: { ...item.mediaMetadata, [field]: e.target.value } })}
            />
          ))}
        </fieldset>
      )}

      <section className="flex flex-col gap-2">
        <h3 className={fieldLabel}>Keywords</h3>
        <ul className="flex flex-wrap gap-1" aria-label="Keywords">
          {item.keywords.map(k => (
            <li key={k} className="inline-flex items-center gap-1 rounded bg-surface-sunken px-1.5 py-0.5">
              {k}
              <button type="button" className="text-content-muted hover:text-danger" aria-label={`Remove keyword ${k}`} onClick={() => onUpdate({ keywords: item.keywords.filter(x => x !== k) })}>
                <X className="h-3 w-3" />
              </button>
            </li>
          ))}
        </ul>
        <form className="flex gap-1" onSubmit={(e) => { e.preventDefault(); addTag(); }}>
          <input aria-label="New keyword" className={`${input} flex-1`} value={tag} onChange={(e) => setTag(e.target.value)} placeholder="Add keyword…" />
          <button type="submit" className={btn}>Add</button>
        </form>
      </section>

      <section className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <h3 className={fieldLabel}>Sources ({item.citations?.length ?? 0})</h3>
          <button type="button" className={`${btnGhost} text-[11px] text-accent`} aria-expanded={adding} onClick={() => setAdding(a => !a)}>
            <Plus className="h-3 w-3" /> Add source
          </button>
        </div>
        {adding && (
          <CitationForm
            onCancel={() => setAdding(false)}
            onSave={(c) => {
              onUpdate({ citations: [...(item.citations ?? []), c] });
              setAdding(false);
            }}
          />
        )}
        {item.citations?.length ? (
          <ul className="flex flex-col gap-1.5">
            {item.citations.map(c => (
              <li key={c.id} className="group relative rounded border border-line bg-surface-sunken p-2">
                <div className="pr-5 font-semibold">{c.source}{c.year ? ` (${c.year})` : ''}</div>
                {c.quote && <div className="italic text-content-muted">“{c.quote}”</div>}
                {c.pageOrUrl && <div className="font-mono text-[10px] text-content-muted">{c.pageOrUrl}</div>}
                <button
                  type="button"
                  className="absolute right-1.5 top-1.5 text-content-muted opacity-0 hover:text-danger focus:opacity-100 group-hover:opacity-100"
                  aria-label={`Remove source ${c.source}`}
                  onClick={() => onUpdate({ citations: item.citations!.filter(x => x.id !== c.id) })}
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </li>
            ))}
          </ul>
        ) : !adding && <p className="italic text-content-muted">No sources recorded.</p>}
      </section>
    </div>
  );
}

function CitationForm({ onSave, onCancel }: { onSave(c: Citation): void; onCancel(): void }) {
  const [source, setSource] = useState('');
  const [quote, setQuote] = useState('');
  const [pageOrUrl, setPageOrUrl] = useState('');
  const [year, setYear] = useState('');
  const optional = (v: string) => v.trim() || undefined;
  return (
    <form
      className="flex flex-col gap-1.5 rounded border border-line p-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (!source.trim()) return;
        onSave({ id: newId(), source: source.trim(), quote: optional(quote), pageOrUrl: optional(pageOrUrl), year: optional(year) });
      }}
    >
      <input aria-label="Source title" className={input} value={source} onChange={(e) => setSource(e.target.value)} placeholder="Book, archive, article… (required)" required />
      <input aria-label="Quote" className={input} value={quote} onChange={(e) => setQuote(e.target.value)} placeholder="Quote or datum" />
      <div className="flex gap-1.5">
        <input aria-label="Page or URL" className={`${input} flex-1`} value={pageOrUrl} onChange={(e) => setPageOrUrl(e.target.value)} placeholder="Page / URL" />
        <input aria-label="Source year" className={`${input} w-20`} value={year} onChange={(e) => setYear(e.target.value)} placeholder="Year" />
      </div>
      <div className="flex justify-end gap-1.5">
        <button type="button" className={btn} onClick={onCancel}>Cancel</button>
        <button type="submit" className={btnPrimary}>Save source</button>
      </div>
    </form>
  );
}

function LinksTab({ item, items, onUpdate, onNavigate }: { item: TreeItem; items: TreeItem[]; onUpdate(patch: Partial<TreeItem>): void; onNavigate(id: string): void }) {
  const [target, setTarget] = useState('');
  const references = item.references ?? [];
  const byId = new Map(items.map(i => [i.id, i]));
  const linkable = items.filter(i => i.id !== item.id && !references.some(r => r.targetId === i.id));
  const linkedHere = items.filter(i => i.references?.some(r => r.targetId === item.id));

  return (
    <div className="flex flex-col gap-4">
      <p className="text-content-muted">Link related research so you can jump between it while writing.</p>
      <ul className="flex flex-col gap-1" aria-label="Links">
        {references.map(r => {
          const linked = byId.get(r.targetId);
          return (
            <li key={r.id} className="group flex items-center justify-between gap-2 rounded border border-line bg-surface-sunken p-1.5">
              {linked ? (
                <button type="button" className="flex min-w-0 items-center gap-1.5 text-left hover:text-accent" onClick={() => onNavigate(linked.id)}>
                  <Link2 className="h-3.5 w-3.5 shrink-0 text-accent" aria-hidden />
                  <span className="truncate">{linked.title || 'Untitled'}</span>
                </button>
              ) : (
                <span className="italic text-content-muted">Missing item</span>
              )}
              <button
                type="button"
                className="text-content-muted opacity-0 hover:text-danger focus:opacity-100 group-hover:opacity-100"
                aria-label={`Remove link to ${linked?.title ?? 'missing item'}`}
                onClick={() => onUpdate({ references: references.filter(x => x.id !== r.id) })}
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </li>
          );
        })}
        {!references.length && <li className="italic text-content-muted">No links yet.</li>}
      </ul>
      {linkable.length > 0 && (
        <form
          className="flex gap-1"
          onSubmit={(e) => {
            e.preventDefault();
            if (!target) return;
            onUpdate({ references: [...references, { id: newId(), targetId: target }] });
            setTarget('');
          }}
        >
          <select aria-label="Item to link" className={`${input} min-w-0 flex-1`} value={target} onChange={(e) => setTarget(e.target.value)}>
            <option value="">Link to…</option>
            {linkable.map(i => <option key={i.id} value={i.id}>{i.title || 'Untitled'}</option>)}
          </select>
          <button type="submit" className={btnPrimary} disabled={!target}>Link</button>
        </form>
      )}
      {linkedHere.length > 0 && (
        <section className="flex flex-col gap-1">
          <h3 className={fieldLabel}>Linked from</h3>
          {linkedHere.map(i => (
            <button key={i.id} type="button" className="truncate text-left hover:text-accent" onClick={() => onNavigate(i.id)}>
              {i.title || 'Untitled'}
            </button>
          ))}
        </section>
      )}
    </div>
  );
}
