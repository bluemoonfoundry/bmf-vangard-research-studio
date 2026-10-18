import { useRef, useState } from 'react';
import { ArrowDown, ArrowUp, Upload, X } from 'lucide-react';
import type { SkippedImport, TextImportBatch } from '@/project/types';
import { parseTranscript, type ImportedFormat, type ParsedTranscript } from '@/chat/importFormats';
import { Modal } from '@/components/workspace/Modal';
import { btn, btnGhost, btnPrimary, fieldLabel, input } from '@/components/workspace/ui';

export interface ImportEntry {
  title: string;
  body: string;
  importedFormat: ImportedFormat;
  sourceUrl?: string;
  importedFrom?: string;
}

export interface ImportChatModalProps {
  importTexts(): Promise<TextImportBatch | null>;
  /** Existing sources, oldest first; `detail` (e.g. the imported file name) tells same-titled versions apart. */
  sources: { id: string; title: string; detail?: string }[];
  /** `position` is the index in `sources` before which the batch goes; sources.length = newest. */
  onImport(entries: ImportEntry[], position: number): void;
  onClose(): void;
}

interface FileRow { key: number; fileName: string; text: string; title: string; parsed: ParsedTranscript }

const DEFAULT_TITLE = 'Imported chat';

const formatLine = (p: ParsedTranscript) =>
  (p.format === 'aistudio-exporter-md' ? `AI Studio export · ${p.turns.length} turn${p.turns.length === 1 ? '' : 's'}` : 'Plain text');

function toEntry(title: string, parsed: ParsedTranscript, importedFrom?: string): ImportEntry {
  const entry: ImportEntry = { title: title.trim() || DEFAULT_TITLE, body: parsed.body, importedFormat: parsed.format };
  if (parsed.sourceUrl) entry.sourceUrl = parsed.sourceUrl;
  if (importedFrom) entry.importedFrom = importedFrom;
  return entry;
}

function Detected({ parsed }: { parsed: ParsedTranscript }) {
  return (
    <div className="flex flex-col gap-0.5 text-content-muted">
      <span>{formatLine(parsed)}</span>
      {parsed.warnings.map(w => <span key={w}>{w}</span>)}
    </div>
  );
}

/**
 * Imports chat transcripts by paste or from files (several at once). AI Studio exports are
 * recognised and stored turn by turn; the batch is placed in the project's source order.
 * Further picks add to the batch; removing every file goes back to paste. Mount fresh for each use.
 */
export function ImportChatModal({ importTexts, sources, onImport, onClose }: ImportChatModalProps) {
  const [title, setTitle] = useState('');
  const [titleEdited, setTitleEdited] = useState(false);
  const [text, setText] = useState('');
  const [pasted, setPasted] = useState<ParsedTranscript | null>(null);
  const [files, setFiles] = useState<FileRow[] | null>(null);
  const [skipped, setSkipped] = useState<SkippedImport[]>([]);
  const [picking, setPicking] = useState(false);
  const [position, setPosition] = useState(sources.length);
  const nextKey = useRef(0);

  const chooseFiles = async () => {
    setPicking(true);
    try {
      const batch = await importTexts();
      if (!batch) return;
      setSkipped(batch.skipped);
      if (!batch.imports.length) return;
      setFiles(rows => {
        const kept = rows ?? [];
        // The same file picked again unchanged is already listed.
        const added = batch.imports
          .filter(i => !kept.some(r => r.fileName === i.fileName && r.text === i.text))
          .map(i => {
            const parsed = parseTranscript(i.text);
            return { key: nextKey.current++, fileName: i.fileName, text: i.text, title: parsed.title ?? i.title, parsed };
          });
        return [...kept, ...added];
      });
    } finally {
      setPicking(false);
    }
  };

  const changeText = (value: string) => {
    const parsed = value.trim() ? parseTranscript(value) : null;
    setText(value);
    setPasted(parsed);
    if (!titleEdited) setTitle(parsed?.title ?? '');
  };

  const remove = (key: number) => setFiles(rows => {
    const next = rows?.filter(r => r.key !== key) ?? [];
    return next.length ? next : null;
  });

  const move = (from: number, to: number) => setFiles(rows => {
    if (!rows || to < 0 || to >= rows.length) return rows;
    const next = [...rows];
    [next[from], next[to]] = [next[to], next[from]];
    return next;
  });

  const entries: ImportEntry[] = files
    ? files.map(f => toEntry(f.title, f.parsed, f.fileName))
    : pasted ? [toEntry(title, pasted)] : [];

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!entries.length) return;
    onImport(entries, position);
    onClose();
  };

  return (
    <Modal
      title="Import chat"
      onClose={onClose}
      footer={(
        <>
          <button type="button" className={btn} onClick={onClose}>Cancel</button>
          <button type="submit" form="import-chat-form" className={btnPrimary} disabled={!entries.length || picking}>Import</button>
        </>
      )}
    >
      <form id="import-chat-form" onSubmit={submit} className="flex flex-col gap-4 text-xs">
        {files ? (
          <ol className="flex flex-col gap-3">
            {files.map((f, i) => (
              <li key={f.key} className="flex items-start gap-2 rounded border border-line p-2">
                <div className="flex flex-1 flex-col gap-1">
                  <input
                    aria-label={`Title for ${f.fileName}`}
                    className={input}
                    value={f.title}
                    onChange={(e) => setFiles(rows => rows!.map(r => (r.key === f.key ? { ...r, title: e.target.value } : r)))}
                  />
                  <span className="truncate text-content-muted">{f.fileName}</span>
                  <Detected parsed={f.parsed} />
                </div>
                <div className="flex flex-col">
                  <button type="button" className={btnGhost} aria-label={`Remove ${f.fileName}`} title="Remove" onClick={() => remove(f.key)}>
                    <X className="h-3.5 w-3.5" />
                  </button>
                  {files.length > 1 && (
                    <>
                      <button type="button" className={btnGhost} aria-label={`Move ${f.fileName} up`} disabled={i === 0} onClick={() => move(i, i - 1)}>
                        <ArrowUp className="h-3.5 w-3.5" />
                      </button>
                      <button type="button" className={btnGhost} aria-label={`Move ${f.fileName} down`} disabled={i === files.length - 1} onClick={() => move(i, i + 1)}>
                        <ArrowDown className="h-3.5 w-3.5" />
                      </button>
                    </>
                  )}
                </div>
              </li>
            ))}
          </ol>
        ) : (
          <>
            <label className="flex flex-col gap-1">
              <span className={fieldLabel}>Title</span>
              <input className={input} value={title} onChange={(e) => { setTitle(e.target.value); setTitleEdited(true); }} placeholder={DEFAULT_TITLE} />
            </label>
            <label className="flex flex-col gap-1">
              <span className={fieldLabel}>Chat text</span>
              <textarea data-autofocus className={`${input} resize-none font-mono`} rows={10} value={text} onChange={(e) => changeText(e.target.value)} placeholder="Paste a chat transcript…" />
            </label>
            {pasted && <Detected parsed={pasted} />}
          </>
        )}
        {skipped.length > 0 && (
          <ul className="flex flex-col gap-0.5 text-content-muted">
            {skipped.map(s => <li key={s.fileName}>{`${s.fileName}: ${s.message}`}</li>)}
          </ul>
        )}
        {sources.length > 0 && (
          <label className="flex flex-col gap-1">
            <span className={fieldLabel}>Place</span>
            <select className={input} value={String(position)} onChange={(e) => setPosition(Number(e.target.value))}>
              <option value="0">Oldest (before everything)</option>
              {sources.map((s, i) => <option key={s.id} value={String(i + 1)}>{`After ${i + 1}. ${s.title || 'Untitled'}${s.detail ? ` (${s.detail})` : ''}`}</option>)}
            </select>
          </label>
        )}
        <div className="flex items-center justify-between gap-3 text-content-muted">
          <span className="truncate">{files ? `${files.length} file${files.length === 1 ? '' : 's'}` : 'Or load files (AI Studio exports, .txt, .md)'}</span>
          <button type="button" className={btn} onClick={() => void chooseFiles()} disabled={picking}>
            <Upload className="h-3.5 w-3.5" /> {files ? 'Add files…' : 'Choose files…'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
