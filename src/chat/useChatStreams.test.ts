import { describe, expect, it } from 'vitest';
import { createElement, type ReactNode } from 'react';
import { act, render, waitFor } from '@testing-library/react';
import { createAiApi } from '@/ai/aiApi';
import type { Capabilities } from '@/ai/types';
import { createProjectApi } from '@/project/api';
import { useProject, type ProjectController } from '@/project/useProject';
import type { TreeItem } from '@/project/types';
import { newTranscript, updateSettings } from '@/chat/transcript';
import { useChatStreams } from '@/chat/useChatStreams';
import { createFakeBridge, makeOpened } from '@/test/fakeBridge';

const DEFAULTS = { provider: 'anthropic' as const, model: 'claude-x' };
const CAPS: Capabilities = { webSearch: true, readUrls: false, temperature: true };
const node = (id: string, type: string, order = 0): TreeItem => ({ id, parentId: null, type, title: id, order, keywords: [] });

type Streams = ReturnType<typeof useChatStreams>;

/** Stands in for ChatEditor: only renders; streaming must not depend on it being mounted. */
function Editor({ project, chatId }: { project: ProjectController; chatId: string }) {
  const text = project.state?.chats[chatId]?.current.messages.map(m => m.text).join('|') ?? '';
  return createElement('div', { 'data-testid': 'editor' }, text);
}

async function setup({ problems = {} as Record<string, string> } = {}) {
  const { bridge, fake } = createFakeBridge();
  const projectApi = createProjectApi(bridge);
  const ai = createAiApi(bridge);
  // What the stream manager is told about each chat's model; null means it isn't usable.
  const box = {} as { project: ProjectController; streams: Streams; caps: (p: string, m: string) => Capabilities | null };
  box.caps = () => CAPS;

  function StreamManager({ project }: { project: ProjectController }): ReactNode {
    box.streams = useChatStreams({ ai, project, capsOf: (p, m) => box.caps(p, m) });
    return null;
  }

  function Host({ showEditor, showStreams = true }: { showEditor: boolean; showStreams?: boolean }): ReactNode {
    const project = useProject(projectApi, bridge.app, { chatDefaults: () => DEFAULTS });
    box.project = project;
    return createElement('div', null,
      showStreams ? createElement(StreamManager, { project }) : null,
      showEditor ? createElement(Editor, { project, chatId: 'c1' }) : null);
  }

  fake.disk.chats = {
    c1: updateSettings(newTranscript(DEFAULTS), { webSearch: true }),
    c2: newTranscript(DEFAULTS),
  };
  bridge.project.readChat.mockImplementation((id: string) => Promise.resolve({
    ok: true, value: problems[id] ? { transcript: null, problem: problems[id] } : { transcript: fake.disk.chats[id] ?? null, problem: null },
  }));
  fake.nextDialogResult = makeOpened({ tree: { items: [node('c1', 'ai-chat'), node('c2', 'ai-chat', 1)] } });
  const view = render(createElement(Host, { showEditor: true }));
  await act(() => box.project.openProject());
  await waitFor(() => expect(Object.keys(box.project.state!.chats).sort()).toEqual(['c1', 'c2']));
  const messages = (id: string) => box.project.state!.chats[id].current.messages;
  return { bridge, fake, box, view, Host, messages };
}

describe('useChatStreams', () => {
  it('send creates a pending message and streams into it', async () => {
    const { fake, box, messages } = await setup();
    act(() => box.streams.send('c1', 'Who is Mara?'));
    await waitFor(() => expect(fake.ai.startedChats).toHaveLength(1));

    const [user, pending] = messages('c1');
    expect(user).toMatchObject({ role: 'user', text: 'Who is Mara?' });
    expect(pending).toMatchObject({ role: 'assistant', text: '', status: 'streaming', usedWebSearch: true });
    expect(box.streams.streamingIds.has('c1')).toBe(true);

    const { requestId, request } = fake.ai.startedChats[0];
    expect(request).toMatchObject({
      provider: 'anthropic', model: 'claude-x', webSearch: true, readUrls: false,
      messages: [{ role: 'user', text: 'Who is Mara?' }],
    });

    act(() => fake.ai.emitChatEvent(requestId, { type: 'text', delta: 'A ' }));
    act(() => fake.ai.emitChatEvent(requestId, { type: 'text', delta: 'sailor.' }));
    act(() => fake.ai.emitChatEvent(requestId, { type: 'done', model: 'claude-x-1' }));

    expect(messages('c1')[1]).toMatchObject({ text: 'A sailor.', status: 'complete', model: 'claude-x-1' });
    expect(box.streams.streamingIds.size).toBe(0);
    // A late event for a finished request goes nowhere.
    act(() => fake.ai.emitChatEvent(requestId, { type: 'text', delta: '!!' }));
    expect(messages('c1')[1].text).toBe('A sailor.');
  });

  it('keeps streaming after the editor unmounts', async () => {
    const { fake, box, view, Host, messages } = await setup();
    act(() => box.streams.send('c1', 'Hello'));
    await waitFor(() => expect(fake.ai.startedChats).toHaveLength(1));
    const { requestId } = fake.ai.startedChats[0];
    act(() => fake.ai.emitChatEvent(requestId, { type: 'text', delta: 'Hi ' }));

    view.rerender(createElement(Host, { showEditor: false }));
    expect(view.queryByTestId('editor')).toBeNull();

    act(() => fake.ai.emitChatEvent(requestId, { type: 'text', delta: 'there' }));
    act(() => fake.ai.emitChatEvent(requestId, { type: 'done', model: 'claude-x' }));
    expect(messages('c1')[1]).toMatchObject({ text: 'Hi there', status: 'complete' });

    view.rerender(createElement(Host, { showEditor: true }));
    expect(view.getByTestId('editor').textContent).toBe('Hello|Hi there');
  });

  it('two chats stream at once', async () => {
    const { fake, box, messages } = await setup();
    act(() => box.streams.send('c1', 'first'));
    act(() => box.streams.send('c2', 'second'));
    await waitFor(() => expect(fake.ai.startedChats).toHaveLength(2));
    expect(box.streams.streamingIds).toEqual(new Set(['c1', 'c2']));
    const [r1, r2] = fake.ai.startedChats.map(c => c.requestId);

    act(() => fake.ai.emitChatEvent(r2, { type: 'text', delta: 'two' }));
    act(() => fake.ai.emitChatEvent(r1, { type: 'text', delta: 'one' }));
    act(() => fake.ai.emitChatEvent(r1, { type: 'done', model: 'm' }));

    expect(messages('c1')[1]).toMatchObject({ text: 'one', status: 'complete' });
    expect(messages('c2')[1]).toMatchObject({ text: 'two', status: 'streaming' });
    expect(box.streams.streamingIds).toEqual(new Set(['c2']));
  });

  it('stop cancels only that chat', async () => {
    const { fake, box, messages } = await setup();
    act(() => box.streams.send('c1', 'first'));
    act(() => box.streams.send('c2', 'second'));
    await waitFor(() => expect(fake.ai.startedChats).toHaveLength(2));
    const [r1, r2] = fake.ai.startedChats.map(c => c.requestId);
    act(() => fake.ai.emitChatEvent(r1, { type: 'text', delta: 'partial' }));

    act(() => box.streams.stop('c1'));
    await waitFor(() => expect(fake.ai.cancelledChats).toEqual([r1]));
    expect(messages('c1')[1]).toMatchObject({ text: 'partial', status: 'cancelled' });
    expect(box.streams.streamingIds).toEqual(new Set(['c2']));
    expect(box.streams.errorOf('c1')).toBeNull();

    act(() => fake.ai.emitChatEvent(r2, { type: 'text', delta: 'still going' }));
    expect(messages('c2')[1]).toMatchObject({ text: 'still going', status: 'streaming' });
  });

  it('resubmit drops later messages and sends history up to the message', async () => {
    const { fake, box, messages } = await setup();
    act(() => box.streams.send('c1', 'one'));
    await waitFor(() => expect(fake.ai.startedChats).toHaveLength(1));
    act(() => fake.ai.emitChatEvent(fake.ai.startedChats[0].requestId, { type: 'text', delta: 'reply' }));
    act(() => fake.ai.emitChatEvent(fake.ai.startedChats[0].requestId, { type: 'done', model: 'm' }));
    const userId = messages('c1')[0].id;

    act(() => box.streams.resubmit('c1', userId, 'one, again'));
    await waitFor(() => expect(fake.ai.startedChats).toHaveLength(2));
    expect(messages('c1').map(m => [m.role, m.text, m.status])).toEqual([
      ['user', 'one, again', undefined], ['assistant', '', 'streaming'],
    ]);
    expect(fake.ai.startedChats[1].request.messages).toEqual([{ role: 'user', text: 'one, again' }]);
  });

  it('refuses to start, leaving the transcript unchanged, when the model is not usable', async () => {
    const { fake, box, messages } = await setup();
    act(() => box.streams.send('c1', 'one'));
    await waitFor(() => expect(fake.ai.startedChats).toHaveLength(1));
    act(() => fake.ai.emitChatEvent(fake.ai.startedChats[0].requestId, { type: 'done', model: 'claude-x' }));
    const before = box.project.state!.chats.c1.current;
    const dirty = box.project.dirty;

    // The model was retired, or the provider's key removed.
    box.caps = () => null;
    act(() => box.streams.resubmit('c1', messages('c1')[0].id));
    act(() => box.streams.send('c1', 'two'));
    expect(box.project.state!.chats.c1.current).toBe(before);
    expect(box.project.dirty).toBe(dirty);
    expect(fake.ai.startedChats).toHaveLength(1);
    expect(box.streams.streamingIds.size).toBe(0);
    expect(box.streams.errorOf('c1')).toMatch(/model isn't available/);
    // Errors belong to their chat.
    expect(box.streams.errorOf('c2')).toBeNull();

    // A later successful start clears it.
    box.caps = () => CAPS;
    act(() => box.streams.send('c1', 'three'));
    await waitFor(() => expect(fake.ai.startedChats).toHaveLength(2));
    expect(box.streams.errorOf('c1')).toBeNull();
  });

  it('never starts a reply in a chat whose file could not be read', async () => {
    const { fake, box } = await setup({ problems: { c2: 'made by a newer version' } });
    const before = box.project.state!.chats.c2.current;
    act(() => box.streams.send('c2', 'hello'));
    expect(box.project.state!.chats.c2.current).toBe(before);
    expect(fake.ai.startedChats).toHaveLength(0);
    expect(box.streams.errorOf('c2')).toMatch(/couldn't be read/);
  });

  it('drops events for a chat that no longer exists', async () => {
    const { fake, box } = await setup();
    act(() => box.streams.send('c1', 'hello'));
    await waitFor(() => expect(fake.ai.startedChats).toHaveLength(1));
    const { requestId } = fake.ai.startedChats[0];
    act(() => box.project.deleteItem('c1'));
    expect(box.project.state!.chats.c1).toBeUndefined();

    act(() => fake.ai.emitChatEvent(requestId, { type: 'text', delta: 'ghost' }));
    act(() => fake.ai.emitChatEvent('unknown-request', { type: 'text', delta: 'stray' }));
    await waitFor(() => expect(fake.ai.cancelledChats).toEqual([requestId]));
    expect(box.project.state!.chats.c1).toBeUndefined();
    expect(box.project.state!.chats.c2.current.messages).toEqual([]);
    expect(box.streams.streamingIds.size).toBe(0);
  });

  it('startChat failure marks the message as error', async () => {
    const { bridge, box, messages } = await setup();
    bridge.ai.startChat.mockImplementationOnce(() =>
      Promise.resolve({ ok: false, error: { code: 'TOO_LARGE', message: 'The chat request is too large.' } }));
    act(() => box.streams.send('c1', 'hello'));
    await waitFor(() => expect(messages('c1')[1].status).toBe('error'));
    expect(messages('c1')[1].error).toEqual({ code: 'TOO_LARGE', message: 'The chat request is too large.' });
    // The failed message shows the reason; a second chat-level alert would repeat it.
    expect(box.streams.errorOf('c1')).toBeNull();
    expect(box.streams.streamingIds.size).toBe(0);
  });

  it('a startChat refused by a racing abort is a quiet cancel', async () => {
    const { bridge, box, messages } = await setup();
    bridge.ai.startChat.mockImplementationOnce(() =>
      Promise.resolve({ ok: false, error: { code: 'CANCELLED', message: 'Cancelled' } }));
    act(() => box.streams.send('c1', 'hello'));
    await waitFor(() => expect(messages('c1')[1].status).toBe('cancelled'));
    expect(box.streams.errorOf('c1')).toBeNull();
  });

  it('stop before startChat resolves cancels again once main has registered the request', async () => {
    const { bridge, fake, box, messages } = await setup();
    let resolveStart!: () => void;
    bridge.ai.startChat.mockImplementationOnce((requestId, request) => {
      fake.ai.startedChats.push({ requestId, request });
      return new Promise(resolve => { resolveStart = () => resolve({ ok: true, value: requestId }); });
    });
    act(() => box.streams.send('c1', 'hello'));
    await waitFor(() => expect(fake.ai.startedChats).toHaveLength(1));
    const { requestId } = fake.ai.startedChats[0];

    act(() => box.streams.stop('c1'));
    await waitFor(() => expect(fake.ai.cancelledChats).toEqual([requestId]));
    expect(messages('c1')[1].status).toBe('cancelled');

    await act(async () => resolveStart());
    await waitFor(() => expect(fake.ai.cancelledChats).toEqual([requestId, requestId]));
    expect(messages('c1')[1].status).toBe('cancelled');
  });

  it('a request that starts normally is not cancelled', async () => {
    const { fake, box } = await setup();
    act(() => box.streams.send('c1', 'hello'));
    await waitFor(() => expect(fake.ai.startedChats).toHaveLength(1));
    await act(async () => {});
    expect(fake.ai.cancelledChats).toEqual([]);
  });

  it('unmount cancels every reply, keeping partial text, even when the cancel is refused', async () => {
    const { bridge, fake, box, view, Host, messages } = await setup();
    act(() => box.streams.send('c1', 'hello'));
    await waitFor(() => expect(fake.ai.startedChats).toHaveLength(1));
    const { requestId } = fake.ai.startedChats[0];
    act(() => fake.ai.emitChatEvent(requestId, { type: 'text', delta: 'half a' }));
    bridge.ai.cancelAll.mockImplementationOnce(() =>
      Promise.resolve({ ok: false, error: { code: 'AI_DISABLED', message: 'AI is off' } }));

    view.rerender(createElement(Host, { showEditor: true, showStreams: false }));
    expect(bridge.ai.cancelAll).toHaveBeenCalledTimes(1);
    expect(messages('c1')[1]).toMatchObject({ text: 'half a', status: 'cancelled' });

    // The stream manager is gone, so a late event changes nothing.
    act(() => fake.ai.emitChatEvent(requestId, { type: 'text', delta: ' reply' }));
    expect(messages('c1')[1].text).toBe('half a');
  });
});
