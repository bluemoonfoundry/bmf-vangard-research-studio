import { useMemo, useState } from 'react';
import type { Bible, EntityKind, FactSource, TreeItem } from '@/project/types';
import type { ChatOf } from '@/chat/types';
import { ENTITY_KINDS, attributeSuggestions, entityKindOf } from '@/bible/entities';
import { setFactStatus, updateFact } from '@/bible/ops';
import { resolveSource, sourceText } from '@/bible/sources';
import { isFolder } from '@/workspace/treeOps';
import type { Canon, ExtractionState, PendingCard, PendingProposal } from '@/extraction/types';
import { approveCard, dismiss, promote, rejectCard, reviewGroups, type ReviewGroup } from '@/extraction/review';
import { EvidenceLabel, FactRow, STRENGTH_LABEL, valueText } from '@/components/bible/FactRow';
import { SourceLink } from '@/components/bible/SourceLink';
import { btn, btnPrimary, fieldLabel, input } from '@/components/workspace/ui';

export interface ReviewQueueProps {
  items: TreeItem[];
  bible: Bible;
  extraction: ExtractionState;
  bodyOf(id: string): string | undefined;
  chatOf: ChatOf;
  updateCanon(update: (c: Canon) => Canon): void;
  /** Creates the entity item for an approved card and returns its id. */
  addEntity(kind: EntityKind, title: string, parentId: string | null): string;
  onOpenSource(source: FactSource): void;
  onOpenCard(id: string): void;
}

const now = () => new Date().toISOString();
const newId = () => crypto.randomUUID();
const kindName = (kind: string) => ENTITY_KINDS.find(k => k.id === kind)?.name ?? 'Entity';

/**
 * AI extraction's review queue, grouped by card: proposed facts to keep or set aside, new cards to
 * approve or reject, and a collapsed pile of suggestions the writer never took up. AI only.
 */
export function ReviewQueue(props: ReviewQueueProps) {
  const { items, bible, extraction, bodyOf, chatOf, updateCanon, onOpenSource, onOpenCard } = props;
  const byId = useMemo(() => new Map(items.map(i => [i.id, i])), [items]);
  const groups = reviewGroups(items, bible, extraction);
  const folders = items.filter(isFolder);
  const [folderOf, setFolderOf] = useState<Record<string, string>>({});

  const stateOf = (s: FactSource) => resolveSource(s, sourceText(s, bodyOf, chatOf), byId.has(s.itemId));
  const setBible = (fn: (b: Bible) => Bible) => updateCanon(c => ({ ...c, bible: fn(c.bible) }));
  const defaultFolder = (kind: string) => items.find(i => entityKindOf(i) === kind)?.parentId ?? '';

  const pendingRow = (p: PendingProposal, actions: React.ReactNode) => {
    const s = p.evidence[0]?.source;
    return (
      <li key={p.id} className="flex items-start justify-between gap-3 rounded border border-line bg-surface-raised px-3 py-2 text-xs">
        <div className="flex min-w-0 flex-col gap-1">
          <span><span className="mr-2 font-semibold">{p.attribute}</span>{valueText(p.value)}</span>
          <EvidenceLabel evidence={p.evidence} replaces={p.replaces} />
          {s && <SourceLink source={s} state={stateOf(s)} title={byId.get(s.itemId)?.title} onOpen={() => onOpenSource(s)} />}
        </div>
        <div className="flex shrink-0 gap-1.5">{actions}</div>
      </li>
    );
  };

  const cardGroup = (g: ReviewGroup & { card: PendingCard }) => {
    const { card } = g;
    const folder = folderOf[card.id] ?? defaultFolder(card.kind);
    return (
      <section key={g.key} aria-label={`New card: ${card.title}`} className="flex flex-col gap-2 rounded border border-accent p-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className={fieldLabel}>New card · {kindName(card.kind)}</span>
            <h3 className="font-serif text-base font-bold">{card.title}</h3>
            {card.reason && <p className="text-xs text-content-muted">{card.reason}</p>}
          </div>
          <div className="flex items-center gap-1.5">
            <select
              aria-label={`Folder for ${card.title}`}
              className={input}
              value={folder}
              onChange={(e) => setFolderOf(f => ({ ...f, [card.id]: e.target.value }))}
            >
              <option value="">Top level</option>
              {folders.map(f => <option key={f.id} value={f.id}>{f.title || 'Untitled'}</option>)}
            </select>
            <button
              type="button"
              className={btnPrimary}
              onClick={() => {
                const entityId = props.addEntity(card.kind, card.title, folder || null);
                updateCanon(c => approveCard(c, card.id, entityId, now(), newId));
              }}
            >
              Approve
            </button>
            <button type="button" className={btn} onClick={() => updateCanon(c => rejectCard(c, card.id, now()))}>Reject</button>
          </div>
        </div>
        <ul className="flex flex-col gap-1.5">
          {g.pending.map(p => pendingRow(p, (
            <button type="button" className={btn} onClick={() => updateCanon(c => dismiss(c, p.id, now()))}>Dismiss</button>
          )))}
        </ul>
      </section>
    );
  };

  const entityGroups = groups.filter(g => g.entity && g.facts.length);
  const cardGroups = groups.filter((g): g is ReviewGroup & { card: PendingCard } => !!g.card);
  const suggestions = groups.filter(g => g.entity && g.pending.length);
  const suggestionCount = suggestions.reduce((n, g) => n + g.pending.length, 0);

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto" data-testid="review-queue">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-4 px-6 py-5">
        <header className="flex flex-col gap-1">
          <h2 className="font-serif text-xl font-bold">Review</h2>
          <p className="text-xs text-content-muted">What AI extraction proposed. Nothing is canon until you keep it.</p>
        </header>
        {!entityGroups.length && !cardGroups.length && !suggestionCount && <p className="text-sm text-content-muted">Nothing to review.</p>}

        {entityGroups.map(g => {
          const entity = g.entity!;
          return (
            <section key={g.key} aria-label={entity.title || 'Untitled'} className="flex flex-col gap-2">
              <button type="button" className="self-start font-serif text-base font-bold text-accent hover:underline" onClick={() => onOpenCard(entity.id)}>
                {entity.title || 'Untitled'}
              </button>
              <ul className="flex flex-col gap-1.5">
                {g.facts.map(f => (
                  <FactRow
                    key={f.id}
                    fact={f}
                    section="pending"
                    showAttribute
                    entity={entity}
                    attributeSuggestions={(k) => attributeSuggestions(bible, items, k)}
                    sourceState={f.source ? stateOf(f.source) : null}
                    sourceTitle={f.source ? byId.get(f.source.itemId)?.title : undefined}
                    onKeep={() => setBible(b => setFactStatus(b, f.id, 'kept', now()))}
                    onSetAside={() => setBible(b => setFactStatus(b, f.id, 'set_aside', now()))}
                    onRestore={() => setBible(b => setFactStatus(b, f.id, 'kept', now()))}
                    onUnreview={() => setBible(b => setFactStatus(b, f.id, 'proposed', now()))}
                    onEdit={(attribute, value) => setBible(b => updateFact(b, f.id, { attribute, value }, now()))}
                    onOpenSource={onOpenSource}
                  />
                ))}
              </ul>
            </section>
          );
        })}

        {cardGroups.map(cardGroup)}

        {suggestionCount > 0 && (
          <details className="rounded border border-line p-3 text-xs">
            <summary className="cursor-pointer font-semibold">Only suggested ({suggestionCount})</summary>
            <p className="mt-2 text-content-muted">{STRENGTH_LABEL.suggested} by the AI and never taken up in the source. Promote one to review it as a fact.</p>
            {suggestions.map(g => (
              <div key={g.key} className="mt-3 flex flex-col gap-1.5">
                <h4 className="font-semibold">{g.entity!.title || 'Untitled'}</h4>
                <ul className="flex flex-col gap-1.5">
                  {g.pending.map(p => pendingRow(p, (
                    <>
                      <button type="button" className={btn} onClick={() => updateCanon(c => promote(c, p.id, now(), newId))}>Promote</button>
                      <button type="button" className={btn} onClick={() => updateCanon(c => dismiss(c, p.id, now()))}>Dismiss</button>
                    </>
                  )))}
                </ul>
              </div>
            ))}
          </details>
        )}
      </div>
    </div>
  );
}
