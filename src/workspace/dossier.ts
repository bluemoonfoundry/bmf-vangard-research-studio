import type { Bible, TreeItem } from '@/project/types';
import { storyBibleMarkdown } from '@/bible/exportMarkdown';
import { childrenOf } from '@/workspace/treeOps';
import { itemTypeName, labelOf, statusName } from '@/workspace/research';

/**
 * Compiles the whole binder into one Markdown document: every item in binder
 * order, nested by heading level, with its index card, body, notes, sources and links.
 */
export function generateDossier(
  projectName: string,
  items: TreeItem[],
  contentOf: (id: string) => string,
  exportedAt: Date = new Date(),
  bible?: Bible,
): string {
  const titleOf = new Map(items.map(i => [i.id, i.title]));
  const out: string[] = [`# ${projectName}: research dossier`, '', `*Exported ${exportedAt.toLocaleString()}*`, ''];

  const visit = (item: TreeItem, depth: number, seen: Set<string>) => {
    if (seen.has(item.id)) return; // a corrupt tree with a cycle must not hang the export
    seen.add(item.id);

    out.push(`${'#'.repeat(Math.min(depth + 1, 6))} ${item.title || 'Untitled'}`, '');
    const facts = [`**Type:** ${itemTypeName(item)}`];
    const label = labelOf(item);
    const status = statusName(item);
    if (label) facts.push(`**Label:** ${label.name}`);
    if (status) facts.push(`**Status:** ${status}`);
    if (item.keywords.length) facts.push(`**Keywords:** ${item.keywords.join(', ')}`);
    out.push(facts.join(' · '), '');

    if (item.url) out.push(`**Source:** <${item.url}>`, '');
    if (item.asset) out.push(`**File:** assets/${item.asset}`, '');
    if (item.synopsis?.trim()) out.push(...item.synopsis.trim().split('\n').map(l => `> ${l}`), '');

    const body = contentOf(item.id).trim();
    if (body) out.push(body, '');
    if (item.documentNotes?.trim()) out.push('**Notes**', '', item.documentNotes.trim(), '');

    if (item.citations?.length) {
      out.push('**Sources**', '');
      for (const c of item.citations) {
        const parts = [`**${c.source}**`];
        if (c.year) parts.push(`(${c.year})`);
        if (c.quote) parts.push(`"${c.quote}"`);
        if (c.pageOrUrl) parts.push(`[${c.pageOrUrl}]`);
        out.push(`- ${parts.join(' ')}`);
      }
      out.push('');
    }
    const links = (item.references ?? []).filter(r => titleOf.has(r.targetId));
    if (links.length) {
      out.push(`**See also:** ${links.map(r => titleOf.get(r.targetId)).join(', ')}`, '');
    }
    out.push('---', '');
    for (const child of childrenOf(items, item.id)) visit(child, depth + 1, seen);
  };

  const seen = new Set<string>();
  for (const root of childrenOf(items, null)) visit(root, 1, seen);
  const bibleSection = bible ? storyBibleMarkdown(items, bible) : '';
  if (bibleSection) out.push(bibleSection);
  return `${out.join('\n').trimEnd()}\n`;
}
