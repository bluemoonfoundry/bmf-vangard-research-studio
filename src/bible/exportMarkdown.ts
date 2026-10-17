import type { Bible, Fact, StoryPosition, TreeItem } from '@/project/types';
import { ENTITY_KINDS, entityKindOf } from '@/bible/entities';
import { attributeKey, formatPosition } from '@/bible/normalize';
import { contradictionKey, findContradictions, groupVersions, openContradictions } from '@/bible/contradictions';
import { buildTimeline } from '@/bible/timeline';

const oneLine = (s: string): string => s.replace(/\s+/g, ' ').trim();
const valueText = (v: string | StoryPosition): string => (typeof v === 'string' ? oneLine(v) : formatPosition(v));
const titleOf = (i: TreeItem): string => oneLine(i.title) || 'Untitled';

/** The Story Bible section of the dossier: kept facts per entity, open conflicts and the timeline. */
export function storyBibleMarkdown(items: TreeItem[], bible: Bible): string {
  const entities = items.filter(i => i.type === 'entity');
  if (entities.length === 0) return '';

  const byId = new Map(items.map(i => [i.id, i]));
  const contradictions = findContradictions(bible, new Set(entities.map(e => e.id)));
  const byKey = new Map(contradictions.map(c => [c.key, c]));
  const out: string[] = ['## Story Bible', ''];

  const sections: { name: string; members: TreeItem[] }[] = ENTITY_KINDS.map(k => ({
    name: k.name,
    members: entities.filter(e => entityKindOf(e) === k.id),
  }));
  sections.push({ name: 'Other', members: entities.filter(e => entityKindOf(e) === null) });

  for (const section of sections) {
    if (section.members.length === 0) continue;
    out.push(`### ${section.name}`, '');
    for (const entity of section.members) {
      out.push(`#### ${titleOf(entity)}`, '');
      const groups = new Map<string, Fact[]>();
      for (const f of bible.facts) {
        if (f.entityId !== entity.id || f.status !== 'kept') continue;
        const key = attributeKey(f.attribute);
        const g = groups.get(key);
        if (g) g.push(f);
        else groups.set(key, [f]);
      }
      for (const facts of groups.values()) {
        const label = oneLine(facts[0].attribute);
        const c = byKey.get(contradictionKey(entity.id, facts[0].attribute));
        if (c && !c.acknowledgedBy) {
          out.push(`- **${label}:** *(unresolved, see Unresolved)*`);
          continue;
        }
        const versions = groupVersions(facts);
        for (const v of versions) out.push(`- **${label}:** ${valueText(v.value)}`);
        if (versions.length > 1) {
          const note = oneLine(c?.acknowledgedBy?.note ?? '');
          out.push(note ? `  *(multiple versions kept: ${note})*` : '  *(multiple versions kept)*');
        }
      }
      out.push('');
    }
  }

  const open = openContradictions(contradictions);
  if (open.length) {
    out.push('### Unresolved', '');
    for (const c of open) {
      const title = titleOf(byId.get(c.entityId) as TreeItem);
      out.push(`- **${title} · ${oneLine(c.attribute)}:** ${c.versions.map(v => valueText(v.value)).join(' / ')}`);
    }
    out.push('');
  }

  const timeline = buildTimeline(bible, items);
  if (timeline.placed.length + timeline.contested.length + timeline.unplaced.length) {
    out.push('### Timeline', '');
    const name = (id: string) => titleOf(byId.get(id) as TreeItem);
    for (const e of timeline.placed) {
      const suffix = e.versionCount > 1 ? ` (version ${e.versionIndex + 1} of ${e.versionCount})` : '';
      out.push(`- ${formatPosition(e.position)}: ${name(e.eventId)}${suffix}`);
    }
    for (const id of timeline.contested) out.push(`- Timing contested: ${name(id)}`);
    for (const id of timeline.unplaced) out.push(`- Unplaced: ${name(id)}`);
    out.push('');
  }

  return out.join('\n').trimEnd();
}
