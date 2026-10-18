import { useMemo, useState } from 'react';
import { ArrowLeft, ExternalLink, Pin, PinOff, Plus, RotateCcw, ScanSearch, Star, X } from 'lucide-react';
import type { Bible, EntityKind, Fact, FactSource, TreeItem } from '@/project/types';
import type { ChatOf } from '@/chat/types';
import type { AssetCache } from '@/workspace/assetCache';
import { useAssetUrl } from '@/workspace/useAssetUrl';
import { ENTITY_KINDS, attributeSuggestions, entityKindOf, isEvent } from '@/bible/entities';
import { findContradictions, openContradictions } from '@/bible/contradictions';
import { addFact, keepAll, keepOne, setFactStatus, updateFact } from '@/bible/ops';
import { isWhenAttribute } from '@/bible/normalize';
import { eventsLinkingTo } from '@/bible/links';
import { resolveSource, sourceText } from '@/bible/sources';
import { cameFrom, canonLines, cardStats, linkedItems, portraitOf, togglePin } from '@/bible/cards';
import { newerVersion } from '@/bible/newer';
import { emptyExtraction, type Canon, type ExtractionState } from '@/extraction/types';
import { liftRejection, rejectionsFor } from '@/extraction/review';
import { dismissFlag, liveFlags } from '@/extraction/conflictCheck';
import { ConflictFlagList } from '@/components/extraction/ConflictCheck';
import { CardBadges } from '@/components/bible/CardWall';
import { FactForm } from '@/components/bible/FactForm';
import { FactRow, valueText } from '@/components/bible/FactRow';
import { Portrait } from '@/components/bible/Portrait';
import { VersionCard } from '@/components/bible/VersionCard';
import { AudioPlayer } from '@/components/workspace/MediaViews';
import { btn, btnGhost, btnPrimary, fieldLabel, input } from '@/components/workspace/ui';

export interface EntityCardProps {
  entity: TreeItem;
  items: TreeItem[];
  bible: Bible;
  assets: AssetCache | null;
  /** The body of an item, or undefined while it loads. */
  bodyOf(id: string): string | undefined;
  chatOf: ChatOf;
  updateBible(update: (b: Bible) => Bible): void;
  onUpdateItem(id: string, patch: Partial<TreeItem>): void;
  onChangeBody(id: string, text: string): void;
  onOpenSource(source: FactSource): void;
  /** Opens any binder item in the research view. */
  onOpenItem(id: string): void;
  /** Opens another entity's full card. */
  onOpenCard(id: string): void;
  onBack(): void;
  /** Source item ids, oldest first, for the "Keep the newer" suggestion. */
  sourceOrder?: readonly string[];
  /** AI on: shows the Rejected list and conflict check flags (needs `extraction` and `updateCanon`). */
  aiEnabled?: boolean;
  extraction?: ExtractionState;
  updateCanon?(update: (c: Canon) => Canon): void;
  /** AI on: opens the semantic conflict check for this card. */
  onCheckConflicts?(): void;
}

const now = () => new Date().toISOString();
const plural = (n: number, one: string) => `${n} ${n === 1 ? one : `${one}s`}`;

function Side({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section aria-label={label} className="flex flex-col gap-1.5">
      <h3 className={fieldLabel}>{label}</h3>
      {children}
    </section>
  );
}

function Thumb({ image, assets }: { image: TreeItem; assets: AssetCache | null }) {
  const state = useAssetUrl(assets, image.asset);
  return state.status === 'ready'
    ? <img src={state.url} alt={image.mediaAlt || image.title} className="h-full w-full object-cover" />
    : <span className="p-1 text-[10px] text-content-muted">{image.title || 'Untitled'}</span>;
}

/** The full-size view of one entity's card: canon, what needs a decision, notes, and what is linked to it. */
export function EntityCard(props: EntityCardProps) {
  const { entity, items, bible, assets, bodyOf, chatOf, updateBible, onUpdateItem, onChangeBody, onOpenSource, onOpenItem, onOpenCard, onBack } = props;
  const { sourceOrder = [], aiEnabled = false, extraction = emptyExtraction(), updateCanon } = props;
  const [adding, setAdding] = useState(false);

  const byId = useMemo(() => new Map(items.map(i => [i.id, i])), [items]);
  const open = useMemo(() => {
    const ids = new Set(items.filter(i => i.type === 'entity').map(i => i.id));
    return openContradictions(findContradictions(bible, ids));
  }, [bible, items]);
  const conflicts = open.filter(c => c.entityId === entity.id);
  const inConflict = new Set(conflicts.flatMap(c => c.factIds));
  const pending = bible.facts.filter(f => f.entityId === entity.id && f.status === 'proposed' && !inConflict.has(f.id));
  const lines = canonLines(bible, entity);
  const stats = cardStats(bible, entity.id, open);
  const linked = linkedItems(entity, byId);
  const portrait = portraitOf(entity, byId);
  const appearsIn = eventsLinkingTo(items, entity.id);
  const sources = cameFrom(bible, entity.id);
  const rejections = aiEnabled && updateCanon ? rejectionsFor(entity, bible, extraction) : [];
  const flags = aiEnabled && updateCanon ? liveFlags(bible, extraction, entity.id) : [];
  const kind = entityKindOf(entity);
  const kindName = ENTITY_KINDS.find(k => k.id === kind)?.name ?? (entity.entityKind || 'Entity');
  const references = entity.references ?? [];
  const linkable = items.filter(i => i.id !== entity.id && i.type !== 'folder' && !references.some(r => r.targetId === i.id));
  const body = bodyOf(entity.id);
  const titleOf = (i: TreeItem | undefined) => i?.title || 'Untitled';

  const suggestions = (k: EntityKind | null) => attributeSuggestions(bible, items, k);
  const unlink = (targetId: string) => onUpdateItem(entity.id, { references: references.filter(r => r.targetId !== targetId) });
  const decide = (apply: (b: Bible, id: string, at: string) => Bible) => updateBible(b => apply(b, crypto.randomUUID(), now()));

  const pendingRow = (f: Fact) => {
    const s = f.source;
    return (
      <FactRow
        key={f.id}
        fact={f}
        section="pending"
        showAttribute
        entity={entity}
        attributeSuggestions={suggestions}
        sourceState={s ? resolveSource(s, sourceText(s, bodyOf, chatOf), byId.has(s.itemId)) : null}
        sourceTitle={s ? byId.get(s.itemId)?.title : undefined}
        onKeep={() => updateBible(b => setFactStatus(b, f.id, 'kept', now()))}
        onSetAside={() => updateBible(b => setFactStatus(b, f.id, 'set_aside', now()))}
        onRestore={() => updateBible(b => setFactStatus(b, f.id, 'kept', now()))}
        onUnreview={() => updateBible(b => setFactStatus(b, f.id, 'proposed', now()))}
        onEdit={(attribute, value) => updateBible(b => updateFact(b, f.id, { attribute, value }, now()))}
        onOpenSource={onOpenSource}
      />
    );
  };

  const linkButton = (i: TreeItem, onOpen: (id: string) => void) => (
    <li key={i.id}>
      <button type="button" className="text-left text-accent hover:underline" onClick={() => onOpen(i.id)}>{titleOf(i)}</button>
    </li>
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto" data-testid="entity-card">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-5 px-6 py-5">
        <div className="flex items-center justify-between gap-2 text-xs">
          <button type="button" className={btn} onClick={onBack}><ArrowLeft className="h-3.5 w-3.5" /> Card wall</button>
          <button type="button" className={btn} onClick={() => onOpenItem(entity.id)}><ExternalLink className="h-3.5 w-3.5" /> Open in editor</button>
        </div>

        <header className="flex items-start gap-4">
          <Portrait entity={entity} image={portrait} assets={assets} size="lg" />
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <input
              aria-label="Title"
              className="min-w-0 border-b border-transparent bg-transparent pb-0.5 font-serif text-2xl font-bold focus:border-accent focus:outline-none"
              value={entity.title}
              placeholder="Untitled"
              onChange={(e) => onUpdateItem(entity.id, { title: e.target.value })}
            />
            <p className="text-xs text-content-muted">
              {kindName} · in {plural(stats.sources, 'source')} · {plural(stats.kept + stats.proposed, 'fact')}
            </p>
            <CardBadges stats={stats} flagged={flags.length} />
            <input
              aria-label="Summary"
              className={`${input} w-full`}
              value={entity.synopsis ?? ''}
              placeholder="A one-line summary…"
              onChange={(e) => onUpdateItem(entity.id, { synopsis: e.target.value })}
            />
          </div>
        </header>

        <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_16rem]">
          <div className="flex min-w-0 flex-col gap-5">
            <section aria-label="Canon" className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <h3 className={fieldLabel}>Canon</h3>
                {!adding && <button type="button" className={btn} onClick={() => setAdding(true)}><Plus className="h-3.5 w-3.5" /> Add fact</button>}
              </div>
              {adding && (
                <FactForm
                  entities={[entity]}
                  fixedEntityId={entity.id}
                  attributeSuggestions={suggestions}
                  onSubmit={(f) => {
                    const t = now();
                    updateBible(b => addFact(b, {
                      id: crypto.randomUUID(), entityId: entity.id, attribute: f.attribute, value: f.value,
                      status: 'kept', origin: 'manual', createdAt: t, updatedAt: t,
                    }));
                    setAdding(false);
                  }}
                  onCancel={() => setAdding(false)}
                />
              )}
              {lines.length === 0 ? (
                <p className="text-xs text-content-muted">Nothing kept yet.</p>
              ) : (
                <ul className="flex flex-col divide-y divide-line rounded border border-line bg-surface-raised text-xs">
                  {lines.map(l => (
                    <li key={l.key} className="flex items-baseline gap-3 px-3 py-1.5">
                      <span className="w-32 shrink-0 font-semibold">{l.attribute}</span>
                      <span className="flex min-w-0 flex-1 flex-col">
                        {l.versions.map((v, i) => (
                          <span key={i} className="flex flex-wrap items-baseline gap-2">
                            <span>{valueText(v.value)}</span>
                            {v.sourceCount > 0 && <span className="text-[11px] text-content-muted">{plural(v.sourceCount, 'source')}</span>}
                          </span>
                        ))}
                      </span>
                      <button
                        type="button"
                        className={btnGhost}
                        aria-label={l.pinned ? `Unpin ${l.attribute} from the card` : `Pin ${l.attribute} to the card`}
                        title={l.pinned ? 'Unpin from the card' : 'Pin to the card'}
                        aria-pressed={l.pinned}
                        onClick={() => onUpdateItem(entity.id, { cardFacts: togglePin(entity, l.attribute) })}
                      >
                        {l.pinned ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section aria-label="Needs a decision" className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <h3 className={fieldLabel}>Needs a decision</h3>
                {aiEnabled && props.onCheckConflicts && (
                  <button type="button" className={btn} title="Ask the AI for facts on this card that can't all be true" onClick={props.onCheckConflicts}>
                    <ScanSearch className="h-3.5 w-3.5" /> Check for conflicts
                  </button>
                )}
              </div>
              {conflicts.length === 0 && pending.length === 0 && flags.length === 0 && <p className="text-xs text-content-muted">Nothing needs a decision.</p>}
              {conflicts.map(c => (
                <div key={c.key} className="flex flex-col gap-2 rounded border border-warning p-3">
                  <h4 className="text-xs font-semibold">{c.attribute}</h4>
                  <div className="grid gap-2 md:grid-cols-2">
                    {c.versions.map((v, i) => (
                      <VersionCard
                        key={i}
                        version={v}
                        checkEventId={isEvent(entity) && isWhenAttribute(c.attribute) ? entity.id : undefined}
                        bible={bible}
                        byId={byId}
                        contentOf={bodyOf}
                        chatOf={chatOf}
                        onKeep={() => decide((b, id, at) => keepOne(b, c, i, { id, now: at }))}
                        onOpenSource={onOpenSource}
                      />
                    ))}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {newerVersion(c, sourceOrder) !== null && (
                      <button
                        type="button"
                        className={btnPrimary}
                        title="Keeps the version from the source furthest down the source order"
                        onClick={() => decide((b, id, at) => keepOne(b, c, newerVersion(c, sourceOrder)!, { id, now: at }))}
                      >
                        Keep the newer
                      </button>
                    )}
                    <button type="button" className={btn} onClick={() => decide((b, id, at) => keepAll(b, c, { id, now: at }))}>
                      {c.versions.length >= 3 ? 'Keep all' : 'Keep both'}
                    </button>
                  </div>
                </div>
              ))}
              {flags.length > 0 && updateCanon && (
                <ConflictFlagList
                  flags={flags}
                  items={items}
                  currentEntityId={entity.id}
                  onDismiss={(flag) => updateCanon(c => ({ ...c, extraction: dismissFlag(c.extraction, flag, c.bible, now()) }))}
                  onSetAside={(id) => updateBible(b => setFactStatus(b, id, 'set_aside', now()))}
                  onOpenCard={onOpenCard}
                />
              )}
              {pending.length > 0 && <ul className="flex flex-col gap-1.5">{pending.map(pendingRow)}</ul>}
            </section>

            <label className="flex flex-col gap-1.5">
              <span className={fieldLabel}>Notes</span>
              {body === undefined ? (
                <span className="text-xs text-content-muted">Loading…</span>
              ) : (
                <textarea
                  aria-label="Notes"
                  className={`${input} min-h-40 resize-y text-sm leading-relaxed`}
                  value={body}
                  placeholder="Anything that isn't a fact. Markdown works."
                  onChange={(e) => onChangeBody(entity.id, e.target.value)}
                />
              )}
            </label>
          </div>

          <aside className="flex flex-col gap-4 text-xs">
            <label className="flex flex-col gap-1">
              <span className={fieldLabel}>Link an item</span>
              <select
                aria-label="Link an item"
                className={input}
                value=""
                onChange={(e) => {
                  if (!e.target.value) return;
                  onUpdateItem(entity.id, { references: [...references, { id: crypto.randomUUID(), targetId: e.target.value }] });
                }}
              >
                <option value="">Choose an image, audio, entity…</option>
                {linkable.map(i => <option key={i.id} value={i.id}>{titleOf(i)}</option>)}
              </select>
            </label>

            {linked.images.length > 0 && (
              <Side label="Images">
                <ul className="grid grid-cols-3 gap-1.5">
                  {linked.images.map(img => (
                    <li key={img.id} className="group relative">
                      <button
                        type="button"
                        aria-label={`Open ${titleOf(img)}`}
                        className={`flex aspect-square w-full items-center justify-center overflow-hidden rounded border bg-surface-sunken ${img.id === portrait?.id ? 'border-accent' : 'border-line'}`}
                        onClick={() => onOpenItem(img.id)}
                      >
                        <Thumb image={img} assets={assets} />
                      </button>
                      <span className="absolute right-0.5 top-0.5 hidden gap-0.5 rounded bg-surface-raised group-focus-within:flex group-hover:flex">
                        {img.id !== portrait?.id && img.asset && (
                          <button type="button" className={btnGhost} aria-label={`Use ${titleOf(img)} as portrait`} title="Use as portrait" onClick={() => onUpdateItem(entity.id, { portraitId: img.id })}>
                            <Star className="h-3 w-3" />
                          </button>
                        )}
                        <button type="button" className={btnGhost} aria-label={`Unlink ${titleOf(img)}`} title="Unlink" onClick={() => unlink(img.id)}>
                          <X className="h-3 w-3" />
                        </button>
                      </span>
                    </li>
                  ))}
                </ul>
              </Side>
            )}

            {linked.audio.length > 0 && (
              <Side label="Audio">
                {linked.audio.map(a => (
                  <div key={a.id} className="flex flex-col gap-1">
                    <span className="flex items-center justify-between gap-1">
                      <button type="button" className="truncate text-accent hover:underline" onClick={() => onOpenItem(a.id)}>{titleOf(a)}</button>
                      <button type="button" className={btnGhost} aria-label={`Unlink ${titleOf(a)}`} onClick={() => unlink(a.id)}><X className="h-3 w-3" /></button>
                    </span>
                    <AudioPlayer item={a} assets={assets} />
                  </div>
                ))}
              </Side>
            )}

            {appearsIn.length > 0 && (
              <Side label="Appears in"><ul className="flex flex-col gap-1">{appearsIn.map(e => linkButton(e, onOpenCard))}</ul></Side>
            )}

            {linked.related.length > 0 && (
              <Side label="Related"><ul className="flex flex-col gap-1">{linked.related.map(e => linkButton(e, onOpenCard))}</ul></Side>
            )}

            {linked.other.length > 0 && (
              <Side label="Linked"><ul className="flex flex-col gap-1">{linked.other.map(i => linkButton(i, onOpenItem))}</ul></Side>
            )}

            {rejections.length > 0 && updateCanon && (
              <Side label="Rejected">
                <ul className="flex flex-col gap-1">
                  {rejections.map(r => (
                    <li key={r.fingerprint} className="flex items-baseline justify-between gap-2">
                      <span className="min-w-0 truncate text-content-muted">{r.label}</span>
                      <button
                        type="button"
                        className={btnGhost}
                        aria-label={`Lift rejection of ${r.label}`}
                        title={r.factId ? 'Back to review' : 'Allow it to be proposed again'}
                        onClick={() => updateCanon(c => liftRejection(c, r.fingerprint, now()))}
                      >
                        <RotateCcw className="h-3 w-3" />
                      </button>
                    </li>
                  ))}
                </ul>
              </Side>
            )}

            {sources.length > 0 && (
              <Side label="Came from">
                <ul className="flex flex-col gap-1">
                  {sources.map(s => {
                    const item = byId.get(s.itemId);
                    return (
                      <li key={s.itemId} className="flex items-baseline justify-between gap-2">
                        {item
                          ? <button type="button" className="truncate text-left text-accent hover:underline" onClick={() => onOpenItem(s.itemId)}>{titleOf(item)}</button>
                          : <span className="text-content-muted">deleted source</span>}
                        <span className="shrink-0 text-[11px] text-content-muted">{plural(s.facts, 'fact')}</span>
                      </li>
                    );
                  })}
                </ul>
              </Side>
            )}
          </aside>
        </div>
      </div>
    </div>
  );
}
