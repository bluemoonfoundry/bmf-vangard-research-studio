import { X } from 'lucide-react';
import { CHAT_PERSONAS } from '@/chat/personas';
import type { ChatSettings } from '@/chat/types';
import { btnGhost, fieldLabel, input } from '@/components/workspace/ui';

interface PersonaDrawerProps {
  personaId: string | null;
  systemPrompt: string;
  onChange(patch: Pick<ChatSettings, 'personaId' | 'systemPrompt'>): void;
  onClose(): void;
}

/** The persona name shown on the header button; an edited prompt is "Custom". */
export const personaName = (personaId: string | null): string =>
  (personaId && CHAT_PERSONAS.find(p => p.id === personaId)?.name) || 'Custom';

/** Persona presets that fill the chat's editable system prompt. Editing the prompt makes it Custom. */
export function PersonaDrawer({ personaId, systemPrompt, onChange, onClose }: PersonaDrawerProps) {
  return (
    <section aria-label="Persona" className="flex flex-col gap-3 border-b border-line bg-surface-raised px-4 py-3 text-xs">
      <div className="flex items-center justify-between">
        <h3 className={fieldLabel}>Persona: {personaName(personaId)}</h3>
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
            className={`flex flex-col gap-1 rounded-md border p-2 text-left ${personaId === p.id ? 'border-accent bg-accent-soft' : 'border-line hover:border-accent'}`}
          >
            <span className="font-semibold">{p.name}</span>
            <span className="line-clamp-2 text-[10px] leading-tight text-content-muted">{p.description}</span>
          </button>
        ))}
      </div>
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
    </section>
  );
}
