import { useState, type FormEvent } from 'react';
import { Pencil, Trash2, X } from 'lucide-react';
import type { PersonaPreset, PersonaPresetInput } from '@/ai/types';
import { CHAT_PERSONAS } from '@/chat/personas';
import type { ChatSettings } from '@/chat/types';
import { ConfirmDialog } from '@/components/workspace/ConfirmDialog';
import { btn, btnGhost, btnPrimary, fieldLabel, input } from '@/components/workspace/ui';

/** The writer's saved personas (app-wide) and how to change them; see useAi. */
export interface PersonaWiring {
  presets: PersonaPreset[];
  /** Creates or updates a preset; throws with a message the drawer shows when refused. */
  save(input: PersonaPresetInput): Promise<PersonaPreset>;
  remove(id: string): Promise<void>;
}

interface PersonaDrawerProps {
  personaId: string | null;
  systemPrompt: string;
  onChange(patch: Pick<ChatSettings, 'personaId' | 'systemPrompt'>): void;
  onClose(): void;
  /** Saved presets; without them the drawer offers only the built-ins. */
  personas?: PersonaWiring;
}

/** The persona name shown on the header button; an edited prompt, or a deleted preset, is "Custom". */
export const personaName = (personaId: string | null, presets: PersonaPreset[] = []): string =>
  (personaId && (CHAT_PERSONAS.find(p => p.id === personaId) ?? presets.find(p => p.id === personaId))?.name) || 'Custom';

const card = (active: boolean) =>
  `flex flex-col gap-1 rounded-md border p-2 text-left ${active ? 'border-accent bg-accent-soft' : 'border-line hover:border-accent'}`;

const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Persona presets that fill the chat's editable system prompt. Editing the prompt makes it Custom. */
export function PersonaDrawer({ personaId, systemPrompt, onChange, onClose, personas }: PersonaDrawerProps) {
  /** The name being typed: for a new preset (`id` null) or a rename. */
  const [naming, setNaming] = useState<{ id: string | null; name: string } | null>(null);
  const [deleting, setDeleting] = useState<PersonaPreset | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const presets = personas?.presets ?? [];

  const submitName = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!personas || !naming || busy) return;
    const renamed = naming.id === null ? undefined : presets.find(p => p.id === naming.id);
    setBusy(true);
    try {
      const preset = await personas.save(renamed
        ? { id: renamed.id, name: naming.name, systemPrompt: renamed.systemPrompt }
        : { name: naming.name, systemPrompt });
      // A new preset becomes this chat's persona; its prompt is already the chat's.
      if (!renamed) onChange({ personaId: preset.id, systemPrompt });
      setNaming(null);
      setError(null);
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setBusy(false);
    }
  };

  const confirmDelete = async () => {
    if (!personas || !deleting) return;
    const { id } = deleting;
    setDeleting(null);
    try {
      await personas.remove(id);
      setError(null);
    } catch (err) {
      setError(messageOf(err));
    }
  };

  const nameField = (
    <form className="flex items-center gap-2" onSubmit={(e) => void submitName(e)}>
      <input
        aria-label="Preset name"
        autoFocus
        className={`${input} min-w-0 flex-1`}
        value={naming?.name ?? ''}
        placeholder="Preset name"
        onChange={(e) => setNaming(n => n && { ...n, name: e.target.value })}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation();
            setNaming(null);
            setError(null);
          }
        }}
      />
      <button type="submit" className={btnPrimary} disabled={busy || !naming?.name.trim()}>
        {naming?.id ? 'Rename' : 'Save preset'}
      </button>
      <button type="button" className={btn} onClick={() => { setNaming(null); setError(null); }}>Cancel</button>
    </form>
  );

  return (
    <section aria-label="Persona" className="flex flex-col gap-3 border-b border-line bg-surface-raised px-4 py-3 text-xs">
      <div className="flex items-center justify-between">
        <h3 className={fieldLabel}>Persona: {personaName(personaId, presets)}</h3>
        <button type="button" className={btnGhost} aria-label="Close persona" onClick={onClose}>
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        {CHAT_PERSONAS.map(p => (
          <button
            key={p.id}
            type="button"
            aria-pressed={personaId === p.id}
            onClick={() => onChange({ personaId: p.id, systemPrompt: p.systemPrompt })}
            className={card(personaId === p.id)}
          >
            <span className="font-semibold">{p.name}</span>
            <span className="line-clamp-2 text-[10px] leading-tight text-content-muted">{p.description}</span>
          </button>
        ))}
      </div>
      {presets.length > 0 && (
        <div className="flex flex-col gap-1">
          <span className={fieldLabel}>My presets</span>
          <ul className="grid grid-cols-1 gap-2 sm:grid-cols-3 lg:grid-cols-5">
            {presets.map(p => (
              <li key={p.id} className="relative">
                {naming?.id === p.id ? nameField : (
                  <>
                    <button
                      type="button"
                      aria-label={p.name}
                      aria-pressed={personaId === p.id}
                      onClick={() => onChange({ personaId: p.id, systemPrompt: p.systemPrompt })}
                      className={`${card(personaId === p.id)} w-full pr-12`}
                    >
                      <span className="truncate font-semibold">{p.name}</span>
                      <span className="line-clamp-2 text-[10px] leading-tight text-content-muted">{p.systemPrompt}</span>
                    </button>
                    <span className="absolute right-1 top-1 flex">
                      <button
                        type="button"
                        className={btnGhost}
                        aria-label={`Rename preset ${p.name}`}
                        onClick={() => { setNaming({ id: p.id, name: p.name }); setError(null); }}
                      >
                        <Pencil className="h-3 w-3" />
                      </button>
                      <button type="button" className={btnGhost} aria-label={`Delete preset ${p.name}`} onClick={() => setDeleting(p)}>
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </span>
                  </>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
      <label className="flex flex-col gap-1">
        <span className={fieldLabel}>System prompt</span>
        <textarea
          aria-label="System prompt"
          rows={5}
          className={`${input} resize-y font-mono leading-relaxed`}
          value={systemPrompt}
          onChange={(e) => onChange({ personaId: null, systemPrompt: e.target.value })}
        />
      </label>
      {personas && (naming?.id === null ? nameField : (
        <div>
          <button
            type="button"
            className={btn}
            disabled={!systemPrompt.trim()}
            onClick={() => { setNaming({ id: null, name: '' }); setError(null); }}
          >
            Save as preset…
          </button>
        </div>
      ))}
      {error && <p role="alert" className="text-danger">{error}</p>}
      {deleting && (
        <ConfirmDialog
          title="Delete preset"
          message={`Delete the preset "${deleting.name}"? Chats that use it keep their prompt.`}
          confirmLabel="Delete"
          onCancel={() => setDeleting(null)}
          onConfirm={() => void confirmDelete()}
        />
      )}
    </section>
  );
}
