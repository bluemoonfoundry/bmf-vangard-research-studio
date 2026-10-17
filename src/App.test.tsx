import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import App from '@/App';
import { createFakeBridge, makeOpened } from '@/test/fakeBridge';

type Fake = ReturnType<typeof createFakeBridge>;
let bridge: Fake['bridge'];
let fake: Fake['fake'];

const docItem = (id: string, title: string, order = 0) =>
  ({ id, parentId: null, type: 'document', title, order, keywords: [] });

beforeEach(() => {
  ({ bridge, fake } = createFakeBridge());
  vi.stubGlobal('vrs', bridge);
  vi.spyOn(window, 'confirm').mockReturnValue(true);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function openProject(project = makeOpened(), docs: Record<string, string> = {}) {
  fake.load(project, docs);
  fake.nextDialogResult = project;
  render(<App />);
  fireEvent.click(await screen.findByRole('button', { name: 'Open project…' }));
  await screen.findByRole('textbox', { name: 'Project name' });
}

async function selectDocument(title: string) {
  fireEvent.click(within(screen.getByRole('list', { name: 'Documents' })).getByRole('button', { name: new RegExp(title) }));
  return screen.findByRole('textbox', { name: 'Document text' });
}

describe('App shell', () => {
  it('shows the product name and the version reported by the main process', async () => {
    render(<App />);
    expect(screen.getByRole('heading', { name: 'Vangard Research Studio' })).toBeInTheDocument();
    expect(await screen.findByText('v9.9.9')).toBeInTheDocument();
  });

  it('still renders when the preload bridge is missing (plain browser dev)', () => {
    vi.stubGlobal('vrs', undefined);
    render(<App />);
    expect(screen.getByRole('heading', { name: 'Vangard Research Studio' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'New project…' })).toBeDisabled();
  });
});

describe('welcome screen', () => {
  it('lists recent projects, flags missing ones, and removes entries', async () => {
    fake.recents = [
      { root: 'C:\\A.vrs', name: 'Alpha', openedAt: 'T', missing: false },
      { root: 'C:\\Gone.vrs', name: 'Gone', openedAt: 'T', missing: true },
    ];
    render(<App />);
    expect(await screen.findByRole('button', { name: 'Open Alpha' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Open Gone' })).toBeDisabled();
    expect(screen.getByText('Not found: C:\\Gone.vrs')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Remove Gone from recent projects' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Open Gone' })).not.toBeInTheDocument());
  });

  it('opens a recent project', async () => {
    fake.recents = [{ root: 'C:\\Research\\Saga.vrs', name: 'Saga', openedAt: 'T', missing: false }];
    fake.nextDialogResult = makeOpened();
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: 'Open Saga' }));
    expect(await screen.findByRole('textbox', { name: 'Project name' })).toHaveValue('Saga');
    expect(bridge.project.openRecent).toHaveBeenCalledWith('C:\\Research\\Saga.vrs');
  });

  it('shows why a project could not be opened', async () => {
    bridge.project.open.mockResolvedValueOnce({ ok: false, error: { code: 'TOO_NEW', message: 'Saved by a newer VRS.' } });
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Open project…' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Saved by a newer VRS.');
  });
});

describe('editing and saving', () => {
  it('tracks unsaved changes and saves new documents', async () => {
    await openProject();
    expect(screen.getByText('Saved')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'New document' }));
    fireEvent.change(await screen.findByRole('textbox', { name: 'Document text' }), { target: { value: 'Dragons hoard words.' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Document title' }), { target: { value: 'Dragons' } });

    expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
    await waitFor(() => expect(bridge.project.setDirty).toHaveBeenLastCalledWith(true));
    expect(document.title).toBe('● Saga — Vangard Research Studio');

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByText('Saved');

    const [saved] = fake.saves;
    expect(saved.tree?.items).toEqual([expect.objectContaining({ title: 'Dragons', type: 'document' })]);
    expect(Object.values(saved.docs ?? {})).toEqual(['Dragons hoard words.']);
    expect(bridge.project.setDirty).toHaveBeenLastCalledWith(false);
  });

  it('loads document bodies on demand and saves only what changed', async () => {
    await openProject(makeOpened({ tree: { items: [docItem('a', 'Alpha'), docItem('b', 'Beta', 1)] } }), { a: 'alpha text', b: 'beta text' });
    const editor = await selectDocument('Alpha');
    expect(editor).toHaveValue('alpha text');
    expect(bridge.project.readDoc).toHaveBeenCalledTimes(1);

    fireEvent.change(editor, { target: { value: 'alpha edited' } });
    fireEvent.keyDown(window, { key: 's', ctrlKey: true });
    await screen.findByText('Saved');
    expect(fake.saves).toEqual([{ docs: { a: 'alpha edited' } }]);
  });

  it('deletes documents on save', async () => {
    await openProject(makeOpened({ tree: { items: [docItem('a', 'Alpha')] } }), { a: 'x' });
    await selectDocument('Alpha');
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByText('Saved');
    expect(fake.saves).toEqual([{ tree: { items: [] }, docs: { a: null } }]);
  });

  it('keeps changes and reports the error when a save fails', async () => {
    await openProject();
    fireEvent.change(screen.getByRole('textbox', { name: 'Project name' }), { target: { value: 'Renamed' } });
    fake.saveError = 'Disk full';
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not save: Disk full');
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
  });

  it('writes a crash-recovery snapshot shortly after edits stop', async () => {
    await openProject();
    fireEvent.change(screen.getByRole('textbox', { name: 'Project name' }), { target: { value: 'Renamed' } });
    await waitFor(() => expect(fake.recoveryWrites).toEqual([{ manifest: { name: 'Renamed' } }]), { timeout: 3000 });
  });
});

describe('recovery and migration notices', () => {
  const recovered = makeOpened({
    tree: { items: [docItem('a', 'Alpha')] },
    recovery: { savedAt: '2026-10-17T10:00:00.000Z', docs: { a: 'unsaved words' } },
  });

  it('restores unsaved work from a crash', async () => {
    await openProject(recovered, { a: 'saved words' });
    fireEvent.click(await screen.findByRole('button', { name: 'Restore' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Restore' })).not.toBeInTheDocument());
    expect(await selectDocument('Alpha')).toHaveValue('unsaved words');
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
  });

  it('discards recovered work on request', async () => {
    await openProject(recovered, { a: 'saved words' });
    fireEvent.click(await screen.findByRole('button', { name: 'Discard' }));
    await waitFor(() => expect(bridge.project.discardRecovery).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: 'Restore' })).not.toBeInTheDocument();
  });

  it('tells the user when a project was upgraded', async () => {
    await openProject(makeOpened({ migratedFrom: 1 }));
    expect(screen.getByText(/upgraded from an older format/)).toBeInTheDocument();
  });
});

describe('external changes', () => {
  const project = makeOpened({ tree: { items: [docItem('a', 'Alpha')] } });

  it('reloads a clean document edited outside VRS', async () => {
    await openProject(project, { a: 'before' });
    const editor = await selectDocument('Alpha');
    fake.disk.docs.a = 'after';
    act(() => fake.emitExternalChange([{ path: 'docs/a.md', deleted: false }]));
    await waitFor(() => expect(editor).toHaveValue('after'));
    expect(screen.getByText('Saved')).toBeInTheDocument();
  });

  it('asks before replacing unsaved edits', async () => {
    await openProject(project, { a: 'before' });
    const editor = await selectDocument('Alpha');
    fireEvent.change(editor, { target: { value: 'mine' } });
    fake.disk.docs.a = 'theirs';
    act(() => fake.emitExternalChange([{ path: 'docs/a.md', deleted: false }]));

    expect(await screen.findByText(/"Alpha" changed on disk/)).toBeInTheDocument();
    expect(editor).toHaveValue('mine');
    fireEvent.click(screen.getByRole('button', { name: 'Reload from disk' }));
    await waitFor(() => expect(editor).toHaveValue('theirs'));
  });

  it('keeps unsaved edits when asked, still marked unsaved', async () => {
    await openProject(project, { a: 'before' });
    const editor = await selectDocument('Alpha');
    fireEvent.change(editor, { target: { value: 'mine' } });
    fake.disk.docs.a = 'theirs';
    act(() => fake.emitExternalChange([{ path: 'docs/a.md', deleted: false }]));
    fireEvent.click(await screen.findByRole('button', { name: 'Keep my version' }));
    await waitFor(() => expect(screen.queryByText(/changed on disk/)).not.toBeInTheDocument());
    expect(editor).toHaveValue('mine');
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
  });

  it('picks up a tree changed outside VRS', async () => {
    await openProject(project, { a: 'x' });
    fake.disk.tree = { items: [docItem('a', 'Alpha'), docItem('b', 'Added in git', 1)] };
    act(() => fake.emitExternalChange([{ path: 'tree.json', deleted: false }]));
    expect(await screen.findByRole('button', { name: /Added in git/ })).toBeInTheDocument();
  });
});

describe('leaving a project with unsaved changes', () => {
  async function openDirty() {
    await openProject();
    fireEvent.change(screen.getByRole('textbox', { name: 'Project name' }), { target: { value: 'Unsaved name' } });
  }

  it('stays put when the user cancels', async () => {
    await openDirty();
    fake.unsavedChoice = 'cancel';
    fireEvent.click(screen.getByRole('button', { name: 'Close project' }));
    await waitFor(() => expect(bridge.project.confirmUnsaved).toHaveBeenCalled());
    expect(bridge.project.close).not.toHaveBeenCalled();
    expect(screen.getByRole('textbox', { name: 'Project name' })).toHaveValue('Unsaved name');
  });

  it('saves before closing when the user chooses Save', async () => {
    await openDirty();
    fake.unsavedChoice = 'save';
    fireEvent.click(screen.getByRole('button', { name: 'Close project' }));
    expect(await screen.findByRole('button', { name: 'New project…' })).toBeInTheDocument();
    expect(fake.saves).toEqual([{ manifest: { name: 'Unsaved name' } }]);
    expect(bridge.project.close).toHaveBeenCalledWith({ discardRecovery: false });
  });

  it('discards the recovery snapshot when the user chooses not to save', async () => {
    await openDirty();
    fake.unsavedChoice = 'discard';
    fireEvent.click(screen.getByRole('button', { name: 'Close project' }));
    expect(await screen.findByRole('button', { name: 'New project…' })).toBeInTheDocument();
    expect(fake.saves).toEqual([]);
    expect(bridge.project.close).toHaveBeenCalledWith({ discardRecovery: true });
  });

  it('saves and then confirms when the window is closing', async () => {
    await openDirty();
    act(() => fake.emitSaveBeforeClose());
    await waitFor(() => expect(bridge.app.closeConfirmed).toHaveBeenCalled());
    expect(fake.saves).toHaveLength(1);
  });

  it('does not close the window if that save fails', async () => {
    await openDirty();
    fake.saveError = 'Disk full';
    act(() => fake.emitSaveBeforeClose());
    expect(await screen.findByRole('alert')).toHaveTextContent('Disk full');
    expect(bridge.app.closeConfirmed).not.toHaveBeenCalled();
  });
});
