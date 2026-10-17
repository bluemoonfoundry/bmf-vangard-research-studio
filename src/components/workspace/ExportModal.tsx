import { useMemo, useState } from 'react';
import { Download } from 'lucide-react';
import type { TreeItem } from '@/project/types';
import { generateDossier } from '@/workspace/dossier';
import { Modal } from '@/components/workspace/Modal';
import { btn, btnPrimary } from '@/components/workspace/ui';

interface ExportModalProps {
  projectName: string;
  items: TreeItem[];
  contentOf(id: string): string | undefined;
  onExport(markdown: string): Promise<string | null>;
  onClose(): void;
}

/** Previews the compiled Markdown dossier and saves it to a file the user picks. */
export function ExportModal({ projectName, items, contentOf, onExport, onClose }: ExportModalProps) {
  const [savedTo, setSavedTo] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const loading = items.some(i => contentOf(i.id) === undefined);
  const markdown = useMemo(
    () => (loading ? '' : generateDossier(projectName, items, id => contentOf(id) ?? '')),
    [loading, projectName, items, contentOf],
  );

  const save = async () => {
    setExporting(true);
    try {
      const path = await onExport(markdown);
      if (path) setSavedTo(path);
    } finally {
      setExporting(false);
    }
  };

  return (
    <Modal
      title="Export research dossier"
      description="Every binder item, in order, with index cards, text, notes, sources and links, as one Markdown file."
      width="max-w-2xl"
      onClose={onClose}
      footer={(
        <>
          <button type="button" className={btn} onClick={onClose}>Close</button>
          <button type="button" className={btnPrimary} onClick={() => void save()} disabled={loading || exporting}>
            <Download className="h-3.5 w-3.5" /> Save as Markdown…
          </button>
        </>
      )}
    >
      <div className="flex flex-col gap-3 text-xs">
        {savedTo && <p role="status" className="rounded border border-accent bg-accent-soft p-2">Saved to {savedTo}</p>}
        <div className="flex items-center justify-between text-content-muted">
          <span className="font-semibold uppercase tracking-wider">Preview</span>
          <span className="font-mono">{items.length} items · {markdown.length.toLocaleString()} characters</span>
        </div>
        <pre aria-label="Dossier preview" className="max-h-80 overflow-auto whitespace-pre-wrap rounded border border-line bg-surface-sunken p-3 font-mono text-[11px] leading-relaxed">
          {loading ? 'Loading documents…' : markdown}
        </pre>
      </div>
    </Modal>
  );
}
