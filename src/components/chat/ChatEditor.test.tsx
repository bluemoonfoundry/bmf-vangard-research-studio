import { describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import type { Capabilities, ModelInfo, ProviderId } from '@/ai/types';
import type { TreeItem } from '@/project/types';
import type { ChatEntry } from '@/project/projectState';
import { emptyBible } from '@/bible/normalize';
import { CHAT_PERSONAS } from '@/chat/personas';
import { newTranscript, updateSettings } from '@/chat/transcript';
import type { ChatMessage, ChatTranscript } from '@/chat/types';
import { buildCanonText } from '@/chat/buildChatRequest';
import { ChatEditor, type ChatEditorProps } from '@/components/chat/ChatEditor';

// Counts canon builds (the context estimate must not rebuild canon on every streamed delta).
vi.mock('@/chat/buildChatRequest', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/chat/buildChatRequest')>();
  return { ...actual, buildCanonText: vi.fn(actual.buildCanonText) };
});

const CAPS_ALL: Capabilities = { webSearch: true, readUrls: true, temperature: true };
const CAPS_NONE: Capabilities = { webSearch: false, readUrls: false, temperature: false };
const MODELS: ModelInfo[] = [
  { id: 'claude-x', name: 'Claude X', inputTokenLimit: 200_000, capabilities: CAPS_ALL },
  { id: 'claude-lite', name: 'Claude Lite', capabilities: CAPS_NONE },
];

const chatItem: TreeItem = { id: 'c1', parentId: null, type: 'ai-chat', title: 'Harbour questions', order: 0, keywords: [] };

const user = (id: string, text: string): ChatMessage => ({ id, role: 'user', text, createdAt: 'T0', edited: false });
const reply = (id: string, text: string, extra: Partial<ChatMessage> = {}): ChatMessage => ({
  id, role: 'assistant', text, createdAt: 'T0', provider: 'anthropic', model: 'claude-x', status: 'complete', error: null, ...extra,
});

const transcript = (messages: ChatMessage[] = [], model = 'claude-x'): ChatTranscript =>
  ({ ...newTranscript({ provider: 'anthropic', model }), messages });

type Overrides = Partial<ChatEditorProps> & { initial?: ChatTranscript };

/** Holds the transcript like project state does, so edits show up. */
function setup({ initial = transcript(), ...overrides }: Overrides = {}) {
  const updates: ChatTranscript[] = [];
  const spies = {
    onSend: vi.fn(), onResubmit: vi.fn(), onStop: vi.fn(), onRename: vi.fn(), onOpenLink: vi.fn(),
    loadModels: vi.fn((_p: ProviderId) => Promise.resolve(MODELS)),
  };
  function Harness() {
    const [entry, setEntry] = useState<ChatEntry>({ saved: initial, current: initial });
    return (
      <ChatEditor
        item={chatItem}
        entry={entry}
        aiEnabled
        configuredProviders={['anthropic']}
        models={() => MODELS}
        streaming={false}
        onUpdate={(update) => setEntry(e => {
          const next = update(e.current);
          updates.push(next);
          return { ...e, current: next };
        })}
        items={[chatItem]}
        bible={emptyBible()}
        contentOf={() => ''}
        {...spies}
        {...overrides}
      />
    );
  }
  render(<Harness />);
  return { ...spies, updates, last: () => updates.at(-1)! };
}

const THREE = [user('u1', 'Who ran the harbour?'), reply('a1', 'The **harbourmaster**.'), user('u2', 'And the tolls?'), reply('a2', 'A penny a barrel.')];

describe('ChatEditor', () => {
  it('existing AI chats open read-only while AI is off', () => {
    setup({ initial: transcript(THREE), aiEnabled: false });
    expect(screen.getByText('Turn on AI in Settings to continue this chat.')).toBeInTheDocument();
    expect(screen.getByText('A penny a barrel.')).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Message' })).toBeNull();
    expect(screen.queryByRole('combobox', { name: 'Provider' })).toBeNull();
    expect(screen.queryByRole('checkbox', { name: 'Web search' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Delete message' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull();
    // Copy isn't an AI feature: it stays in a read-only transcript.
    expect(screen.getAllByRole('button', { name: 'Copy' })).toHaveLength(4);
  });

  it('filters a read-only chat without changing the file', () => {
    const { updates } = setup({ initial: transcript(THREE), aiEnabled: false });
    fireEvent.click(screen.getByRole('button', { name: 'AI' }));
    expect(screen.getAllByRole('article')).toHaveLength(2);
    expect(updates).toHaveLength(0);
  });

  it('shows a notice for a chat file that could not be read', () => {
    function Problem() {
      const t = transcript();
      return (
        <ChatEditor
          item={chatItem} entry={{ saved: null, current: t, problem: 'not valid JSON' }} aiEnabled configuredProviders={['anthropic']}
          models={() => MODELS} loadModels={() => Promise.resolve(MODELS)} streaming={false}
          onUpdate={vi.fn()} onRename={vi.fn()} onSend={vi.fn()} onResubmit={vi.fn()} onStop={vi.fn()}
          items={[chatItem]} bible={emptyBible()} contentOf={() => ''} onOpenLink={vi.fn()}
        />
      );
    }
    render(<Problem />);
    expect(screen.getByText("This chat file couldn't be read: not valid JSON")).toBeInTheDocument();
  });

  it('toggles hidden when the model lacks the capability', () => {
    setup({ initial: transcript([], 'claude-lite') });
    expect(screen.queryByRole('checkbox', { name: 'Web search' })).toBeNull();
    expect(screen.queryByRole('checkbox', { name: 'Read URLs' })).toBeNull();
    expect(screen.queryByRole('slider', { name: 'Temperature' })).toBeNull();
  });

  it('toggling Web search saves it on the chat', () => {
    const { last } = setup();
    const toggle = screen.getByRole('checkbox', { name: 'Web search' });
    expect(toggle).not.toBeChecked();
    fireEvent.click(toggle);
    expect(last().settings.webSearch).toBe(true);
    expect(screen.getByRole('checkbox', { name: 'Web search' })).toBeChecked();
  });

  it('sets temperature and resets it to the provider default', () => {
    const { last } = setup();
    fireEvent.change(screen.getByRole('slider', { name: 'Temperature' }), { target: { value: '1.3' } });
    expect(last().settings.temperature).toBe(1.3);
    fireEvent.click(screen.getByRole('button', { name: 'Default' }));
    expect(last().settings.temperature).toBeNull();
  });

  it('unavailable model blocks send', () => {
    const { onSend } = setup({ initial: transcript([], 'claude-retired') });
    expect(screen.getByRole('option', { name: 'claude-retired (unavailable)' })).toBeInTheDocument();
    fireEvent.change(screen.getByRole('textbox', { name: 'Message' }), { target: { value: 'Hello' } });
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Message' }), { key: 'Enter' });
    expect(onSend).not.toHaveBeenCalled();
  });

  it('Enter sends, Shift+Enter does not', () => {
    const { onSend } = setup();
    const box = screen.getByRole('textbox', { name: 'Message' });
    fireEvent.change(box, { target: { value: 'Who kept the light?' } });
    fireEvent.keyDown(box, { key: 'Enter', shiftKey: true });
    expect(onSend).not.toHaveBeenCalled();
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(onSend).toHaveBeenCalledWith('Who kept the light?');
    expect(box).toHaveValue('');
  });

  it('persona preset fills the prompt; editing makes it Custom', () => {
    const { last } = setup();
    fireEvent.click(screen.getByRole('button', { name: /Persona/ }));
    const scholar = CHAT_PERSONAS.find(p => p.id === 'historical_scholar')!;
    fireEvent.click(screen.getByRole('button', { name: new RegExp(scholar.name) }));
    expect(last().settings).toMatchObject({ personaId: 'historical_scholar', systemPrompt: scholar.systemPrompt });
    expect(screen.getByRole('textbox', { name: 'System prompt' })).toHaveValue(scholar.systemPrompt);

    fireEvent.change(screen.getByRole('textbox', { name: 'System prompt' }), { target: { value: 'Be terse.' } });
    expect(last().settings).toMatchObject({ personaId: null, systemPrompt: 'Be terse.' });
    expect(screen.getByRole('button', { name: /Persona: Custom/ })).toBeInTheDocument();
  });

  it('edit → save text only does not call the provider', () => {
    const { last, onResubmit, onSend } = setup({ initial: transcript(THREE) });
    const first = screen.getByRole('article', { name: 'You: Who ran the harbour?' });
    fireEvent.click(within(first).getByRole('button', { name: 'Edit' }));
    fireEvent.change(within(first).getByRole('textbox', { name: 'Edit message' }), { target: { value: 'Who ran the port?' } });
    fireEvent.click(within(first).getByRole('button', { name: 'Save text only' }));
    expect(last().messages[0]).toMatchObject({ text: 'Who ran the port?', edited: true });
    expect(last().messages).toHaveLength(4);
    expect(onResubmit).not.toHaveBeenCalled();
    expect(onSend).not.toHaveBeenCalled();
  });

  it('edit → save & resubmit sends the new text', () => {
    const { onResubmit } = setup({ initial: transcript(THREE) });
    const first = screen.getByRole('article', { name: 'You: Who ran the harbour?' });
    fireEvent.click(within(first).getByRole('button', { name: 'Edit' }));
    fireEvent.change(within(first).getByRole('textbox', { name: 'Edit message' }), { target: { value: 'Who ran the port?' } });
    fireEvent.click(within(first).getByRole('button', { name: 'Save & resubmit' }));
    expect(onResubmit).toHaveBeenCalledWith('u1', 'Who ran the port?');
  });

  it('resubmit drops later messages without a confirm', () => {
    const { onResubmit } = setup({ initial: transcript(THREE) });
    fireEvent.click(within(screen.getByRole('article', { name: 'You: Who ran the harbour?' })).getByRole('button', { name: 'Resubmit' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(onResubmit).toHaveBeenCalledWith('u1', undefined);
  });

  it('deletes one message', () => {
    const { last } = setup({ initial: transcript(THREE) });
    fireEvent.click(within(screen.getByRole('article', { name: 'You: And the tolls?' })).getByRole('button', { name: 'Delete message' }));
    expect(last().messages.map(m => m.id)).toEqual(['u1', 'a1', 'a2']);
  });

  it('delete all after asks for confirmation with the count', () => {
    const { last, updates } = setup({ initial: transcript(THREE) });
    fireEvent.click(within(screen.getByRole('article', { name: 'You: Who ran the harbour?' })).getByRole('button', { name: 'Delete all after' }));
    const dialog = screen.getByRole('dialog', { name: 'Delete messages' });
    expect(dialog).toHaveTextContent('Delete the 3 messages after this one?');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(updates).toHaveLength(0);

    fireEvent.click(within(screen.getByRole('article', { name: 'You: Who ran the harbour?' })).getByRole('button', { name: 'Delete all after' }));
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Delete messages' })).getByRole('button', { name: 'Delete' }));
    expect(last().messages.map(m => m.id)).toEqual(['u1']);
  });

  it('delete all before asks for confirmation with the count', () => {
    const { last } = setup({ initial: transcript(THREE) });
    fireEvent.click(within(screen.getByRole('article', { name: 'You: And the tolls?' })).getByRole('button', { name: 'Delete all before' }));
    const dialog = screen.getByRole('dialog', { name: 'Delete messages' });
    expect(dialog).toHaveTextContent('Delete the 2 messages before this one?');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
    expect(last().messages.map(m => m.id)).toEqual(['u2', 'a2']);
  });

  it('filter shows only my messages with the n of m notice', () => {
    const { last } = setup({ initial: transcript(THREE) });
    fireEvent.click(screen.getByRole('button', { name: 'Mine' }));
    expect(last().settings.filterMode).toBe('user_only');
    expect(screen.getAllByRole('article')).toHaveLength(2);
    expect(screen.getByText('Showing 2 of 4 messages')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'All' }));
    expect(screen.getAllByRole('article')).toHaveLength(4);
    expect(screen.queryByText(/Showing \d+ of/)).toBeNull();
  });

  it('renders replies as sanitized Markdown with a provider · model stamp', () => {
    setup({ initial: transcript(THREE) });
    const answer = screen.getByRole('article', { name: /^AI: The \*\*harbourmaster\*\*/ });
    expect(within(answer).getByText('harbourmaster').tagName).toBe('STRONG');
    expect(within(answer).getByText('Anthropic Claude · claude-x')).toBeInTheDocument();
  });

  it('sources render as links that open externally', () => {
    const sourced = reply('a1', 'See the ledger.', { sources: [{ title: 'Port ledger', url: 'https://example.org/ledger' }] });
    const { onOpenLink } = setup({ initial: transcript([user('u1', 'Where?'), sourced]) });
    const link = screen.getByRole('link', { name: 'Port ledger' });
    fireEvent.click(link);
    expect(onOpenLink).toHaveBeenCalledWith('https://example.org/ledger');
  });

  it('shows cancelled and error badges', () => {
    setup({
      initial: transcript([
        user('u1', 'One'), reply('a1', 'Half an ans', { status: 'cancelled' }),
        user('u2', 'Two'), reply('a2', '', { status: 'error', error: { code: 'RATE_LIMIT', message: 'Too many requests' } }),
      ]),
    });
    expect(screen.getByText('Stopped')).toBeInTheDocument();
    expect(screen.getByText('Too many requests')).toBeInTheDocument();
  });

  it('actions disabled and Stop shown while streaming', () => {
    const streamingReply = reply('a2', 'A penny', { status: 'streaming' });
    const { onStop } = setup({ initial: transcript([...THREE.slice(0, 3), streamingReply]), streaming: true });
    const first = screen.getByRole('article', { name: 'You: Who ran the harbour?' });
    for (const name of ['Edit', 'Resubmit', 'Delete message', 'Delete all before', 'Delete all after']) {
      expect(within(first).getByRole('button', { name })).toBeDisabled();
    }
    expect(screen.queryByRole('button', { name: 'Send' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
    expect(onStop).toHaveBeenCalled();
  });

  it('attaches binder items and shows deleted ones as missing', () => {
    const doc: TreeItem = { id: 'd1', parentId: null, type: 'document', title: 'Tide tables', order: 1, keywords: [] };
    const entity: TreeItem = { id: 'e1', parentId: null, type: 'entity', title: 'Mara', order: 2, keywords: [] };
    const initial = updateSettings(transcript(), { attachments: ['gone'] });
    const { last } = setup({ initial, items: [chatItem, doc, entity] });
    fireEvent.click(screen.getByRole('button', { name: /Attachments/ }));
    expect(screen.getByText('Missing item (deleted)')).toBeInTheDocument();
    const picker = screen.getByRole('combobox', { name: 'Attach an item' });
    expect(within(picker).queryByRole('option', { name: 'Mara' })).toBeNull();
    expect(within(picker).queryByRole('option', { name: 'Harbour questions' })).toBeNull();
    fireEvent.change(picker, { target: { value: 'd1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Attach' }));
    expect(last().settings.attachments).toEqual(['gone', 'd1']);
    fireEvent.click(screen.getByRole('button', { name: 'Remove Tide tables' }));
    expect(last().settings.attachments).toEqual(['gone']);
  });

  it('warns when the context nears the model input limit', () => {
    const big: TreeItem = { id: 'd1', parentId: null, type: 'document', title: 'Big', order: 1, keywords: [] };
    const small = [{ ...MODELS[0], inputTokenLimit: 1000 }];
    setup({ initial: updateSettings(transcript(), { attachments: ['d1'] }), items: [chatItem, big], contentOf: () => 'x'.repeat(4000), models: () => small });
    expect(screen.getByText(/~\d[\d,]* tokens/)).toHaveTextContent(/of 1,000/);
    expect(screen.getByRole('status', { name: 'Context size' })).toHaveAttribute('data-warning', 'true');
  });

  it('shows Loading models… while the list loads', () => {
    setup({ models: () => undefined, loadModels: vi.fn(() => new Promise<ModelInfo[]>(() => {})) });
    expect(screen.getByText('Loading models…')).toBeInTheDocument();
  });

  it('shows a failed model load with Retry instead of loading again', async () => {
    let failed = false;
    const loadModels = vi.fn(async () => {
      failed = true;
      return [];
    });
    const { rerender } = render(<StaticEditor loadModels={loadModels} models={() => undefined} modelsError={() => null} />);
    await act(async () => {});
    expect(loadModels).toHaveBeenCalledTimes(1);
    expect(failed).toBe(true);
    rerender(<StaticEditor loadModels={loadModels} models={() => undefined} modelsError={() => 'Network is down'} />);
    await act(async () => {});
    expect(screen.getByRole('alert')).toHaveTextContent("Couldn't load models: Network is down");
    expect(loadModels).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(loadModels).toHaveBeenLastCalledWith('anthropic', true);
  });

  it('"Save text only" is disabled once a reply is streaming', () => {
    const t = transcript(THREE);
    const { rerender } = render(<StaticEditor entry={{ saved: t, current: t }} />);
    const first = () => screen.getByRole('article', { name: 'You: Who ran the harbour?' });
    fireEvent.click(within(first()).getByRole('button', { name: 'Edit' }));
    rerender(<StaticEditor entry={{ saved: t, current: t }} streaming />);
    expect(within(first()).getByRole('button', { name: 'Save text only' })).toBeDisabled();
    expect(within(first()).getByRole('button', { name: 'Save & resubmit' })).toBeDisabled();
  });

  it('does not rebuild canon when only a streaming reply grows', () => {
    const streamingAt = (text: string) => transcript([user('u1', 'Who?'), reply('a1', text, { status: 'streaming' })]);
    const first = streamingAt('Ta');
    const { rerender } = render(<StaticEditor entry={{ saved: first, current: first }} streaming />);
    const builds = vi.mocked(buildCanonText).mock.calls.length;
    expect(builds).toBeGreaterThan(0);
    for (const text of ['Tam', 'Tamsin', 'Tamsin kept it.']) {
      const next = streamingAt(text);
      rerender(<StaticEditor entry={{ saved: first, current: next }} streaming />);
    }
    expect(vi.mocked(buildCanonText).mock.calls.length).toBe(builds);
    expect(screen.getByText('Tamsin kept it.')).toBeInTheDocument();
  });
});

const STATIC_ITEMS = [chatItem];
const STATIC_BIBLE = emptyBible();
const STATIC_ENTRY: ChatEntry = { saved: transcript(), current: transcript() };
const noContent = () => '';
const noop = () => {};

/** ChatEditor with stable props (no state), for rerender tests. */
function StaticEditor(props: Partial<ChatEditorProps>) {
  return (
    <ChatEditor
      item={chatItem} entry={STATIC_ENTRY} aiEnabled configuredProviders={['anthropic']}
      models={() => MODELS} loadModels={() => Promise.resolve(MODELS)} streaming={false}
      onUpdate={noop} onRename={noop} onSend={noop} onResubmit={noop} onStop={noop}
      items={STATIC_ITEMS} bible={STATIC_BIBLE} contentOf={noContent} onOpenLink={noop}
      {...props}
    />
  );
}

describe('fact capture from messages', () => {
  const mara: TreeItem = { id: 'mara', parentId: null, type: 'entity', entityKind: 'character', title: 'Mara', order: 1, keywords: [] } as TreeItem;
  const STORED = 'The **harbourmaster** said a penny a barrel.';
  const TALK = [user('u1', 'Who set the tolls?'), reply('a1', STORED)];

  /** Selects `needle` inside `root`'s text, across element boundaries if need be. */
  function selectIn(root: HTMLElement, needle: string) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes: Text[] = [];
    while (walker.nextNode()) nodes.push(walker.currentNode as Text);
    const full = nodes.map(n => n.data).join('');
    const at = full.indexOf(needle);
    if (at < 0) throw new Error(`"${needle}" not in "${full}"`);
    const point = (offset: number): [Text, number] => {
      let seen = 0;
      for (const n of nodes) {
        if (offset <= seen + n.data.length) return [n, offset - seen];
        seen += n.data.length;
      }
      throw new Error('offset out of range');
    };
    const range = document.createRange();
    range.setStart(...point(at));
    range.setEnd(...point(at + needle.length));
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);
    fireEvent.mouseUp(root);
  }

  function captureSetup(overrides: Partial<ChatEditorProps> = {}) {
    let bible = emptyBible();
    function Harness() {
      const [b, setB] = useState(emptyBible());
      bible = b;
      const entry: ChatEntry = { saved: transcript(TALK), current: transcript(TALK) };
      return (
        <ChatEditor
          item={chatItem} entry={entry} aiEnabled={false} configuredProviders={['anthropic']}
          models={() => MODELS} loadModels={() => Promise.resolve(MODELS)} streaming={false}
          onUpdate={noop} onRename={noop} onSend={noop} onResubmit={noop} onStop={noop}
          items={[chatItem, mara]} bible={b} contentOf={noContent} onOpenLink={noop}
          capture={{
            bible: { items: [chatItem, mara], bible: b, bodyOf: noContent, chatOf: () => undefined, updateBible: (u) => setB(u), onOpenSource: noop },
            addEntity: () => 'new',
          }}
          {...overrides}
        />
      );
    }
    render(<Harness />);
    return { bible: () => bible };
  }

  const aiMessage = () => screen.getAllByRole('article')[1];

  it('capturing from a rendered message stores messageId and exact offsets', () => {
    const { bible } = captureSetup();
    selectIn(within(aiMessage()).getByText(/said a penny/), 'said a penny');
    fireEvent.change(screen.getByLabelText('Entity'), { target: { value: 'mara' } });
    fireEvent.change(screen.getByLabelText('Attribute'), { target: { value: 'toll' } });
    fireEvent.change(screen.getByLabelText('Value'), { target: { value: 'a penny' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save fact' }));

    const source = bible().facts[0].source!;
    expect(source).toEqual({ itemId: 'c1', messageId: 'a1', quote: 'said a penny', start: 22, end: 34 });
    expect(STORED.slice(source.start, source.end)).toBe('said a penny');
  });

  it('selection across Markdown syntax suggests Show raw', () => {
    const { bible } = captureSetup();
    selectIn(within(aiMessage()).getByText(/said a penny/).closest('p')!, 'The harbourmaster said');
    expect(screen.queryByRole('button', { name: 'Save fact' })).toBeNull();
    expect(within(aiMessage()).getByText("Couldn't match this selection to the message text. Use Show raw to capture.")).toBeInTheDocument();
    // Clicking away clears the note; a new unmatched selection brings it back.
    window.getSelection()!.removeAllRanges();
    fireEvent.mouseUp(document.body);
    expect(within(aiMessage()).queryByText(/Couldn't match this selection/)).toBeNull();
    selectIn(within(aiMessage()).getByText(/said a penny/).closest('p')!, 'The harbourmaster said');
    expect(within(aiMessage()).getByText(/Couldn't match this selection/)).toBeInTheDocument();

    fireEvent.click(within(aiMessage()).getByRole('button', { name: 'Show raw' }));
    const raw = within(aiMessage()).getByLabelText('Raw message text');
    expect(raw).toHaveTextContent(STORED);
    selectIn(raw, '**harbourmaster** said');
    fireEvent.change(screen.getByLabelText('Entity'), { target: { value: 'mara' } });
    fireEvent.change(screen.getByLabelText('Attribute'), { target: { value: 'role' } });
    fireEvent.change(screen.getByLabelText('Value'), { target: { value: 'harbourmaster' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save fact' }));
    expect(bible().facts[0].source).toEqual({ itemId: 'c1', messageId: 'a1', quote: '**harbourmaster** said', start: 4, end: 26 });
  });

  it('marks a highlighted message range in raw view', () => {
    captureSetup({ highlight: { messageId: 'a1', start: 22, end: 34 } });
    const raw = within(aiMessage()).getByLabelText('Raw message text');
    expect(raw.querySelector('mark')).toHaveTextContent('said a penny');
    // Other messages stay rendered.
    expect(within(screen.getAllByRole('article')[0]).queryByLabelText('Raw message text')).toBeNull();
  });
});
