import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import App from '@/App';
import type { Bible, TreeItem } from '@/project/types';
import { createFakeBridge, makeOpened } from '@/test/fakeBridge';

type Fake = ReturnType<typeof createFakeBridge>;
let bridge: Fake['bridge'];
let fake: Fake['fake'];

const item = (id: string, title: string, extra: Partial<TreeItem> = {}): TreeItem =>
  ({ id, parentId: null, type: 'document', title, order: 0, keywords: [], ...extra });

beforeEach(() => {
  ({ bridge, fake } = createFakeBridge());
  vi.stubGlobal('vrs', bridge);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function open(items: TreeItem[] = [], docs: Record<string, string> = {}, bible?: Bible) {
  const project = makeOpened({ tree: { items }, ...(bible && { bible }) });
  fake.load(project, docs);
  fake.nextDialogResult = project;
  render(<App />);
  fireEvent.click(await screen.findByRole('button', { name: 'Open project…' }));
  await screen.findByRole('textbox', { name: 'Project name' });
  // Every body is read once on open.
  if (items.length) await waitFor(() => expect(bridge.project.readDoc).toHaveBeenCalledTimes(items.length));
}

const tree = () => screen.getByRole('tree', { name: 'Binder items' });
const treeItem = (name: string) => within(tree()).getByRole('treeitem', { name });
const inspector = () => screen.getByRole('complementary', { name: 'Inspector' });

async function save() {
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await screen.findByText('Saved');
  return fake.saves.at(-1)!;
}

const folder = (id: string, title: string, extra: Partial<TreeItem> = {}) => item(id, title, { type: 'folder', ...extra });

describe('binder', () => {
  it('creates a folder and shows it as an empty corkboard', async () => {
    await open();
    fireEvent.click(screen.getByRole('button', { name: 'New folder' }));
    expect(treeItem('New folder')).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('No cards here yet')).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: /New card/ })[0]);
    expect(treeItem('Untitled document')).toHaveAttribute('aria-level', '2');
  });

  it('nests new documents in the selected folder and saves the hierarchy', async () => {
    await open([folder('f', 'People')]);
    fireEvent.click(treeItem('People'));
    fireEvent.click(screen.getByRole('button', { name: 'New document' }));
    fireEvent.change(await screen.findByRole('textbox', { name: 'Document title' }), { target: { value: 'Ada' } });

    expect(treeItem('Ada')).toHaveAttribute('aria-level', '2');
    const saved = await save();
    expect(saved.tree?.items.find(i => i.title === 'Ada')).toMatchObject({ parentId: 'f', type: 'document' });
  });

  it('collapses folders and reorders with Alt+arrow keys', async () => {
    await open([folder('f', 'People'), item('a', 'Ada', { parentId: 'f', order: 0 }), item('b', 'Bo', { parentId: 'f', order: 1 })]);
    fireEvent.click(screen.getByRole('button', { name: 'Collapse People' }));
    expect(within(tree()).queryByRole('treeitem', { name: 'Ada' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Expand People' }));

    fireEvent.keyDown(treeItem('Bo'), { key: 'ArrowUp', altKey: true });
    const names = within(tree()).getAllByRole('treeitem').map(el => el.getAttribute('aria-label'));
    expect(names).toEqual(['People', 'Bo', 'Ada']);
    expect(treeItem('Bo')).toHaveAttribute('aria-posinset', '1');
  });

  it('duplicates a folder with its contents under new ids', async () => {
    await open([folder('f', 'People'), item('a', 'Ada', { parentId: 'f' })], { f: 'folder notes', a: 'Ada body' });
    fireEvent.click(screen.getByRole('button', { name: 'Duplicate People' }));
    await within(tree()).findByRole('treeitem', { name: 'People (copy)' });
    expect(within(tree()).getAllByRole('treeitem').map(el => el.getAttribute('aria-label')))
      .toEqual(['People', 'Ada', 'People (copy)', 'Ada']);

    const saved = await save();
    const copies = saved.tree!.items.filter(i => !['f', 'a'].includes(i.id));
    expect(copies).toHaveLength(2);
    expect(new Set(saved.tree!.items.map(i => i.id)).size).toBe(4);
    expect(Object.values(saved.docs ?? {}).sort()).toEqual(['Ada body', 'folder notes']);
  });

  it('asks before deleting, then drops links to the item and its file', async () => {
    await open([
      item('a', 'Map', { type: 'image', asset: 'map.png' }),
      item('b', 'Notes', { order: 1, references: [{ id: 'r', targetId: 'a' }] }),
    ]);
    fireEvent.click(within(tree()).getByRole('button', { name: 'Delete Map' }));
    const dialog = screen.getByRole('dialog', { name: 'Delete item' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(treeItem('Map')).toBeInTheDocument();

    fireEvent.click(within(tree()).getByRole('button', { name: 'Delete Map' }));
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Delete item' })).getByRole('button', { name: 'Delete' }));
    const saved = await save();
    expect(saved.tree!.items).toEqual([expect.objectContaining({ id: 'b', references: [] })]);
    expect(saved.deletedAssets).toEqual(['map.png']);
  });

  it('searches text, wildcards and regular expressions', async () => {
    await open([item('a', 'Harbour'), item('b', 'Lighthouse', { order: 1, label: 'setting' })], { a: 'Tide tables of 1684', b: 'A tower' });
    const search = screen.getByRole('searchbox', { name: 'Search the binder' });

    fireEvent.change(search, { target: { value: 'tide' } });
    const results = await screen.findByRole('list', { name: 'Search results' });
    expect(within(results).getAllByRole('listitem')).toHaveLength(1);
    expect(within(results).getByText('Harbour')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Regex' }));
    fireEvent.change(search, { target: { value: '(' } });
    expect(await screen.findByText(/Invalid pattern/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Wildcard' }));
    fireEvent.change(search, { target: { value: 'light*' } });
    await waitFor(() => expect(within(screen.getByRole('list', { name: 'Search results' })).getByText('Lighthouse')).toBeInTheDocument());
  });

  it('finds unsaved edits', async () => {
    await open([item('a', 'Harbour')], { a: 'old' });
    fireEvent.click(treeItem('Harbour'));
    fireEvent.change(await screen.findByRole('textbox', { name: 'Document text' }), { target: { value: 'kraken sighting' } });
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search the binder' }), { target: { value: 'kraken' } });
    expect(await within(await screen.findByRole('list', { name: 'Search results' })).findByText('Harbour')).toBeInTheDocument();
  });
});

describe('views', () => {
  const people = () => [
    folder('f', 'People'),
    item('a', 'Zed', { parentId: 'f', order: 0, synopsis: 'last' }),
    item('b', 'Ada', { parentId: 'f', order: 1, label: 'character' }),
  ];

  it('shows a folder as index cards whose synopsis edits reach the inspector', async () => {
    await open(people(), { a: 'one two three' });
    fireEvent.click(treeItem('People'));
    const cards = screen.getByRole('list', { name: 'Index cards' });
    expect(within(cards).getAllByRole('listitem').map(c => c.getAttribute('aria-label'))).toEqual(['Zed', 'Ada']);
    expect(within(cards).getByText('3 words')).toBeInTheDocument();

    fireEvent.click(within(cards).getByRole('listitem', { name: 'Zed' }));
    fireEvent.change(within(cards).getByRole('textbox', { name: 'Synopsis of Zed' }), { target: { value: 'Harbour master' } });
    expect(within(inspector()).getByRole('textbox', { name: 'Index card synopsis' })).toHaveValue('Harbour master');
  });

  it('opens a card in the editor and sorts the outliner', async () => {
    await open(people());
    fireEvent.click(treeItem('People'));
    fireEvent.click(screen.getByRole('button', { name: 'Open Ada' }));
    expect(await screen.findByRole('textbox', { name: 'Document title' })).toHaveValue('Ada');

    fireEvent.keyDown(window, { key: '3', ctrlKey: true });
    const table = await screen.findByRole('table');
    const titles = () => within(table).getAllByRole('textbox', { name: /^Title of/ }).map(i => (i as HTMLInputElement).value);
    expect(titles()).toEqual(['Zed', 'Ada']);
    fireEvent.click(within(table).getByRole('button', { name: 'Title' }));
    expect(titles()).toEqual(['Ada', 'Zed']);
    fireEvent.change(within(table).getByRole('combobox', { name: 'Label of Zed' }), { target: { value: 'lore' } });
    const saved = await save();
    expect(saved.tree!.items.find(i => i.id === 'a')).toMatchObject({ label: 'lore' });
  });

  it('shows two editors side by side whose toolbars format their own text', async () => {
    await open([item('a', 'Alpha'), item('b', 'Beta', { order: 1 })], { a: 'left', b: 'right' });
    fireEvent.click(treeItem('Alpha'));
    fireEvent.click(screen.getByRole('button', { name: 'Split side by side' }));
    expect(screen.getByRole('separator', { name: 'Resize split' })).toHaveAttribute('aria-orientation', 'vertical');

    const second = screen.getByRole('region', { name: 'Second pane' });
    expect(within(second).getByRole('combobox', { name: 'Item in second pane' })).toHaveValue('b');
    const rightText = within(second).getByRole('textbox', { name: 'Document text' }) as HTMLTextAreaElement;
    rightText.setSelectionRange(0, 5);
    fireEvent.click(within(second).getByRole('button', { name: 'Bold' }));
    expect(rightText).toHaveValue('**right**');
    const editors = screen.getAllByRole('textbox', { name: 'Document text' });
    expect(editors[0]).toHaveValue('left');

    fireEvent.click(screen.getByRole('button', { name: 'Stack panes' }));
    expect(screen.getByRole('separator')).toHaveAttribute('aria-orientation', 'horizontal');
    fireEvent.keyDown(screen.getByRole('separator'), { key: 'ArrowDown' });
    expect(screen.getByRole('separator')).toHaveAttribute('aria-valuenow', '55');
    fireEvent.click(screen.getByRole('button', { name: 'Close second pane' }));
    expect(screen.queryByRole('separator')).not.toBeInTheDocument();
  });

  it('resets per-document editor state when switching documents', async () => {
    await open([item('a', 'Alpha'), item('b', 'Beta', { order: 1 })], { a: '# Heading', b: 'plain' });
    fireEvent.click(treeItem('Alpha'));
    fireEvent.click(await screen.findByRole('button', { name: 'Preview' }));
    expect(screen.getByRole('heading', { name: 'Heading' })).toBeInTheDocument();
    fireEvent.click(treeItem('Beta'));
    expect(await screen.findByRole('textbox', { name: 'Document text' })).toHaveValue('plain');
  });
});

describe('document preview', () => {
  it('sanitizes Markdown and opens links in the system browser', async () => {
    await open([item('a', 'Alpha')], { a: '<img src=x onerror="alert(1)">\n\n[Archive](https://archive.example/doc)' });
    fireEvent.click(treeItem('Alpha'));
    fireEvent.click(await screen.findByRole('button', { name: 'Preview' }));
    expect(document.querySelector('[onerror]')).toBeNull();
    fireEvent.click(screen.getByRole('link', { name: 'Archive' }));
    await waitFor(() => expect(fake.openedLinks).toEqual(['https://archive.example/doc']));
  });
});

describe('inspector', () => {
  it('edits label, keywords, sources and a word goal', async () => {
    await open([item('a', 'Alpha')], { a: 'one two three four' });
    fireEvent.click(treeItem('Alpha'));
    const panel = inspector();
    fireEvent.change(within(panel).getByRole('combobox', { name: 'Label' }), { target: { value: 'plot' } });

    fireEvent.click(within(panel).getByRole('tab', { name: 'Metadata' }));
    fireEvent.change(within(panel).getByRole('textbox', { name: 'New keyword' }), { target: { value: 'tides' } });
    fireEvent.click(within(panel).getByRole('button', { name: 'Add' }));
    fireEvent.click(within(panel).getByRole('button', { name: /Add source/ }));
    fireEvent.change(within(panel).getByRole('textbox', { name: 'Source title' }), { target: { value: 'Ship log' } });
    fireEvent.change(within(panel).getByRole('textbox', { name: 'Source year' }), { target: { value: '1684' } });
    fireEvent.click(within(panel).getByRole('button', { name: 'Save source' }));
    expect(within(panel).getByText('Ship log (1684)')).toBeInTheDocument();

    fireEvent.click(within(panel).getByRole('button', { name: 'Set goal' }));
    fireEvent.click(within(panel).getByRole('button', { name: '250' }));
    expect(within(panel).getByRole('progressbar', { name: 'Word goal progress' })).toHaveAttribute('aria-valuenow', '2');

    const saved = await save();
    expect(saved.tree!.items[0]).toMatchObject({
      label: 'plot', keywords: ['tides'], targetWordCount: 250,
      citations: [expect.objectContaining({ source: 'Ship log', year: '1684' })],
    });
  });

  it('links items by id, so renaming the target updates the link', async () => {
    await open([item('a', 'Alpha'), item('b', 'Beta', { order: 1 })]);
    fireEvent.click(treeItem('Alpha'));
    fireEvent.click(within(inspector()).getByRole('tab', { name: 'Links' }));
    fireEvent.change(within(inspector()).getByRole('combobox', { name: 'Item to link' }), { target: { value: 'b' } });
    fireEvent.click(within(inspector()).getByRole('button', { name: 'Link' }));

    fireEvent.click(treeItem('Beta'));
    fireEvent.change(await screen.findByRole('textbox', { name: 'Document title' }), { target: { value: 'Beta renamed' } });
    // Beta's inspector lists Alpha under "Linked from".
    fireEvent.click(within(inspector()).getByRole('button', { name: 'Alpha' }));
    fireEvent.click(within(inspector()).getByRole('tab', { name: /Links/ }));
    const links = within(inspector()).getByRole('list', { name: 'Links' });
    expect(within(links).getByText('Beta renamed')).toBeInTheDocument();
    const saved = await save();
    expect(saved.tree!.items.find(i => i.id === 'a')!.references).toEqual([{ id: expect.any(String), targetId: 'b' }]);
  });
});

describe('add item dialog', () => {
  it('starts from the current folder every time it opens', async () => {
    await open([folder('f', 'People'), folder('g', 'Places', { order: 1 })]);
    fireEvent.click(treeItem('People'));
    fireEvent.click(screen.getByRole('button', { name: 'New item' }));
    let dialog = screen.getByRole('dialog', { name: 'Add to binder' });
    expect(within(dialog).getByRole('combobox', { name: 'Folder' })).toHaveValue('f');
    fireEvent.keyDown(dialog, { key: 'Escape' });

    fireEvent.click(treeItem('Places'));
    fireEvent.click(screen.getByRole('button', { name: 'New item' }));
    dialog = screen.getByRole('dialog', { name: 'Add to binder' });
    expect(within(dialog).getByRole('combobox', { name: 'Folder' })).toHaveValue('g');
    expect(within(dialog).getByRole('textbox', { name: 'Title' })).toHaveValue('');
  });

  it('imports an image into the project and creates an image item', async () => {
    await open();
    fake.nextImport = { asset: 'img1.png', originalName: 'Harbour chart', bytes: 2048 };
    fireEvent.click(screen.getByRole('button', { name: 'New item' }));
    const dialog = screen.getByRole('dialog', { name: 'Add to binder' });
    fireEvent.click(within(dialog).getByRole('radio', { name: 'Image' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Choose file…' }));
    await waitFor(() => expect(within(dialog).getByRole('textbox', { name: 'Title' })).toHaveValue('Harbour chart'));
    expect(bridge.project.importMedia).toHaveBeenCalledWith('image');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create' }));

    expect(await screen.findByRole('img', { name: 'Harbour chart' })).toHaveAttribute('src', expect.stringMatching(/^blob:/));
    const saved = await save();
    expect(saved.tree!.items).toEqual([expect.objectContaining({ type: 'image', title: 'Harbour chart', asset: 'img1.png' })]);
  });

  it('discards an imported file when the dialog is cancelled', async () => {
    await open();
    fake.nextImport = { asset: 'tape.mp3', originalName: 'tape', bytes: 10 };
    fireEvent.click(screen.getByRole('button', { name: 'New item' }));
    const dialog = screen.getByRole('dialog', { name: 'Add to binder' });
    fireEvent.click(within(dialog).getByRole('radio', { name: 'Audio' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Choose file…' }));
    await within(dialog).findByText(/tape \(1 KB\)/);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));

    fireEvent.change(screen.getByRole('textbox', { name: 'Project name' }), { target: { value: 'Renamed' } });
    expect((await save()).deletedAssets).toEqual(['tape.mp3']);
  });

  it('creates a web clip that opens in the system browser', async () => {
    await open();
    fireEvent.click(screen.getByRole('button', { name: 'New item' }));
    const dialog = screen.getByRole('dialog', { name: 'Add to binder' });
    fireEvent.click(within(dialog).getByRole('radio', { name: 'Web clip' }));
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Title' }), { target: { value: 'Tide article' } });
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Source URL' }), { target: { value: 'https://tides.example/a' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Open in browser' }));
    await waitFor(() => expect(bridge.app.openExternal).toHaveBeenCalledWith('https://tides.example/a'));
  });
});

describe('story bible items', () => {
  it('imports pasted chat as a read-only chat item with LF text', async () => {
    await open();
    fireEvent.click(screen.getByRole('button', { name: 'Import chat' }));
    const dialog = screen.getByRole('dialog', { name: 'Import chat' });
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Chat text' }), { target: { value: 'You: hi\r\nAI: hello' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Import' }));
    expect(treeItem('Imported chat')).toBeInTheDocument();
    expect(await screen.findByText(/You: hi/)).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Document text' })).toBeNull();
    const saved = await save();
    expect(saved.tree!.items).toEqual([expect.objectContaining({ type: 'chat', title: 'Imported chat' })]);
    const body = Object.values(fake.disk.docs).join('');
    expect(body).toContain('You: hi\nAI: hello');
    expect(body).not.toContain('\r');
  });

  it('imports a chat file with its title', async () => {
    await open();
    fake.nextTextImport = { title: 'Session 3', text: 'a\nb', fileName: 'Session 3.txt' };
    fireEvent.click(screen.getByRole('button', { name: 'Import chat' }));
    const dialog = screen.getByRole('dialog', { name: 'Import chat' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'From file…' }));
    await waitFor(() => expect(within(dialog).getByRole('textbox', { name: 'Title' })).toHaveValue('Session 3'));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Import' }));
    expect(await screen.findByRole('treeitem', { name: 'Session 3' })).toBeInTheDocument();
    expect((await save()).tree!.items).toEqual([expect.objectContaining({ type: 'chat', importedFrom: 'Session 3.txt' })]);
  });

  it('creates an entity of a chosen kind', async () => {
    await open();
    fireEvent.click(screen.getByRole('button', { name: 'New item' }));
    const dialog = screen.getByRole('dialog', { name: 'Add to binder' });
    fireEvent.click(within(dialog).getByRole('radio', { name: 'Entity' }));
    fireEvent.change(within(dialog).getByRole('combobox', { name: 'Kind' }), { target: { value: 'event' } });
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Title' }), { target: { value: 'The Siege' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create' }));
    expect(await screen.findByRole('treeitem', { name: 'The Siege' })).toBeInTheDocument();
    expect((await save()).tree!.items).toEqual([expect.objectContaining({ type: 'entity', entityKind: 'event' })]);
  });
});

describe('media', () => {
  it('plays audio from the project and reloads an asset changed on disk', async () => {
    fake.disk.assets['tape.mp3'] = new Uint8Array([1]);
    await open([item('a', 'Interview', { type: 'audio', asset: 'tape.mp3' })]);
    fireEvent.click(treeItem('Interview'));
    expect(await screen.findByRole('button', { name: 'Play' })).toBeInTheDocument();
    expect(document.querySelector('audio')?.getAttribute('src')).toMatch(/^blob:/);
    expect(bridge.project.readAsset).toHaveBeenCalledTimes(1);

    act(() => fake.emitExternalChange([{ path: 'assets/tape.mp3', deleted: false }]));
    await waitFor(() => expect(bridge.project.readAsset).toHaveBeenCalledTimes(2));
  });

  it('reports a missing asset and replaces the file, discarding the old one', async () => {
    await open([item('a', 'Chart', { type: 'image', asset: 'gone.png' })]);
    fireEvent.click(treeItem('Chart'));
    expect(await screen.findByRole('alert')).toHaveTextContent(/gone.png is missing/);

    fake.nextImport = { asset: 'new.png', originalName: 'new', bytes: 1 };
    fireEvent.click(screen.getByRole('button', { name: 'Replace file…' }));
    await screen.findByRole('img', { name: 'Chart' });
    const saved = await save();
    expect(saved.tree!.items[0].asset).toBe('new.png');
    expect(saved.deletedAssets).toEqual(['gone.png']);
  });
});

describe('quick reference and export', () => {
  it('shows the live item, not a snapshot', async () => {
    await open([item('a', 'Alpha')], { a: 'body' });
    fireEvent.click(screen.getByRole('button', { name: 'Quick reference for Alpha' }));
    expect(screen.getByRole('region', { name: 'Quick reference: Alpha' })).toBeInTheDocument();
    fireEvent.click(treeItem('Alpha'));
    fireEvent.change(await screen.findByRole('textbox', { name: 'Document title' }), { target: { value: 'Alpha prime' } });
    expect(screen.getByRole('region', { name: 'Quick reference: Alpha prime' })).toBeInTheDocument();
  });

  it('exports the binder as a Markdown dossier', async () => {
    await open([folder('f', 'People'), item('a', 'Ada', { parentId: 'f', synopsis: 'Navigator' })], { a: 'Charts the coast.' });
    fake.nextExportPath = 'C:\\Exports\\Saga dossier.md';
    fireEvent.click(screen.getByRole('button', { name: 'Export' }));
    const dialog = screen.getByRole('dialog', { name: 'Export research dossier' });
    expect(within(dialog).getByLabelText('Dossier preview')).toHaveTextContent('### Ada');
    fireEvent.click(within(dialog).getByRole('button', { name: /Save as Markdown/ }));
    expect(await within(dialog).findByRole('status')).toHaveTextContent('Saved to C:\\Exports\\Saga dossier.md');
    expect(fake.exports[0]).toMatch(/^# Saga: research dossier/);
    expect(fake.exports[0]).toContain('> Navigator\n\nCharts the coast.');
  });
});

describe('conflict queue', () => {
  const mara = item('m', 'Mara', { type: 'entity', entityKind: 'character' } as Partial<TreeItem>);
  const fact = (id: string, value: string) => ({
    id, entityId: 'm', attribute: 'death', value, status: 'kept' as const, origin: 'manual', createdAt: 'T0', updatedAt: 'T0',
  });
  const bible = (): Bible => ({ facts: [fact('a', 'Season 3 finale'), fact('b', 'Pilot')], dependencies: [], decisions: [] });
  const badge = () => within(screen.getByRole('button', { name: /Conflicts/ })).getByText(/^\d+$/);

  it('counts open contradictions and shows two cards', async () => {
    await open([mara], {}, bible());
    expect(badge()).toHaveTextContent('1');
    fireEvent.click(screen.getByRole('button', { name: /Conflicts/ }));
    expect(screen.getAllByRole('article')).toHaveLength(2);
  });

  it('drops the badge to 0 after Keep this one, and Reopen restores it', async () => {
    await open([mara], {}, bible());
    fireEvent.click(screen.getByRole('button', { name: /Conflicts/ }));
    fireEvent.click(within(screen.getAllByRole('article')[0]).getByRole('button', { name: 'Keep this one' }));
    expect(badge()).toHaveTextContent('0');
    fireEvent.click(screen.getByRole('button', { name: 'Decided' }));
    fireEvent.click(screen.getByRole('button', { name: 'Reopen' }));
    expect(badge()).toHaveTextContent('1');
  });

  it('opens from an entity page and returns to research on a binder pick', async () => {
    await open([mara], {}, bible());
    fireEvent.click(treeItem('Mara'));
    fireEvent.click(await screen.findByRole('button', { name: /conflict queue/i }));
    expect(screen.getAllByRole('article')).toHaveLength(2);
    fireEvent.click(treeItem('Mara'));
    expect(screen.queryByRole('article')).toBeNull();
  });
});

describe('delete warning for story bible facts', () => {
  const src = (n: string) => ({ itemId: 'c', quote: 'q', start: 0, end: 1 + n.length });
  const f = (id: string, entityId: string, withSource: boolean) => ({
    id, entityId, attribute: 'death', value: 'x', status: 'kept' as const, origin: 'manual', createdAt: 'T0', updatedAt: 'T0',
    ...(withSource && { source: src(id) }),
  });

  it('tells how many facts cite a chat', async () => {
    const mara = item('m', 'Mara', { type: 'entity', entityKind: 'character' } as Partial<TreeItem>);
    await open([item('c', 'Session', { type: 'chat' }), mara], {}, {
      facts: [f('a', 'm', true), f('b', 'm', true)], dependencies: [], decisions: [],
    });
    fireEvent.click(within(tree()).getByRole('button', { name: 'Delete Session' }));
    expect(screen.getByRole('dialog', { name: 'Delete item' })).toHaveTextContent("2 facts cite this item. They'll keep their quotes.");
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Delete item' })).getByRole('button', { name: 'Cancel' }));
    fireEvent.click(within(tree()).getByRole('button', { name: 'Delete Mara' }));
    expect(screen.getByRole('dialog', { name: 'Delete item' })).toHaveTextContent('This removes 2 facts about it.');
  });

  it('does not count a fact twice when it is about a deleted entity and cites a deleted item', async () => {
    const mara = item('m', 'Mara', { type: 'entity', entityKind: 'character' } as Partial<TreeItem>);
    await open([mara], {}, {
      facts: [{ ...f('a', 'm', false), source: { itemId: 'm', quote: 'q', start: 0, end: 1 } }], dependencies: [], decisions: [],
    });
    fireEvent.click(within(tree()).getByRole('button', { name: 'Delete Mara' }));
    const dialog = screen.getByRole('dialog', { name: 'Delete item' });
    expect(dialog).toHaveTextContent('This removes 1 fact about it.');
    expect(dialog).not.toHaveTextContent('cite');
  });

  it('ignores orphan facts in the delete warning', async () => {
    await open([item('c', 'Session', { type: 'chat' })], {}, {
      facts: [f('a', 'missing', true)], dependencies: [], decisions: [],
    });
    fireEvent.click(within(tree()).getByRole('button', { name: 'Delete Session' }));
    expect(screen.getByRole('dialog', { name: 'Delete item' })).not.toHaveTextContent('cite');
  });

  it('uses singular wording for one fact', async () => {
    const mara = item('m', 'Mara', { type: 'entity', entityKind: 'character' } as Partial<TreeItem>);
    await open([item('c', 'Session', { type: 'chat' }), mara], {}, {
      facts: [f('a', 'm', true)], dependencies: [], decisions: [],
    });
    fireEvent.click(within(tree()).getByRole('button', { name: 'Delete Session' }));
    expect(screen.getByRole('dialog', { name: 'Delete item' })).toHaveTextContent("1 fact cites this item. It'll keep its quote.");
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Delete item' })).getByRole('button', { name: 'Cancel' }));
    fireEvent.click(within(tree()).getByRole('button', { name: 'Delete Mara' }));
    expect(screen.getByRole('dialog', { name: 'Delete item' })).toHaveTextContent('This removes 1 fact about it.');
  });
});
