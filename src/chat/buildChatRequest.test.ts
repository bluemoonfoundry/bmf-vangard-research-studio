import { describe, expect, it } from 'vitest';
import type { Capabilities } from '@/ai/types';
import type { Bible, Decision, Dependency, Fact, TreeItem } from '@/project/types';
import { emptyBible } from '@/bible/normalize';
import { newTranscript, updateSettings } from '@/chat/transcript';
import type { ChatMessage, ChatTranscript } from '@/chat/types';
import {
  buildAttachmentsText, buildCanonText, buildChatRequest, estimateTokens, VRS_PREAMBLE,
} from '@/chat/buildChatRequest';

let n = 0;
const fact = (over: Partial<Fact> = {}): Fact => ({
  id: `f${++n}`, entityId: 'mara', attribute: 'Eyes', value: 'green', status: 'kept', origin: 'manual',
  createdAt: 'T0', updatedAt: 'T0', ...over,
});
const node = (id: string, type: string, over: Partial<TreeItem> = {}): TreeItem => ({
  id, parentId: null, type, title: id, order: 0, keywords: [], ...over,
});
const bibleOf = (facts: Fact[], dependencies: Dependency[] = []): Bible => ({ ...emptyBible(), facts, dependencies });

const ALL: Capabilities = { webSearch: true, readUrls: true, temperature: true };
const NONE: Capabilities = { webSearch: false, readUrls: false, temperature: false };

const msg = (id: string, role: 'user' | 'assistant', text: string, over: Partial<ChatMessage> = {}): ChatMessage => ({
  id, role, text, createdAt: 'T0', ...over,
});

function chat(messages: ChatMessage[], settings: Partial<ChatTranscript['settings']> = {}): ChatTranscript {
  const t = updateSettings(newTranscript({ provider: 'anthropic', model: 'claude-x' }), {
    systemPrompt: 'You are helpful.', ...settings,
  });
  return { ...t, messages };
}

const entities = [
  node('mara', 'entity', { title: 'Mara', entityKind: 'character' }),
  node('ash', 'entity', { title: 'Ashford', entityKind: 'location' }),
  node('fire', 'entity', { title: 'The Fire', entityKind: 'event' }),
  node('flood', 'entity', { title: 'The Flood', entityKind: 'event' }),
];

describe('buildCanonText', () => {
  it('canon includes only kept facts', () => {
    const bible = bibleOf([
      fact({ attribute: 'Eyes', value: 'green' }),
      fact({ attribute: 'Hair', value: 'red', status: 'proposed' }),
      fact({ attribute: 'Age', value: '40', status: 'set_aside' }),
      fact({ entityId: 'ash', attribute: 'Climate', value: 'Damp,\n  foggy' }),
    ]);
    expect(buildCanonText(entities, bible)).toBe([
      '### Ashford (Location)',
      '- Climate: Damp, foggy',
      '',
      '### Mara (Character)',
      '- Eyes: green',
    ].join('\n'));
    expect(buildCanonText(entities, emptyBible())).toBe('');
    expect(buildCanonText(entities, bibleOf([fact({ status: 'proposed' })]))).toBe('');
  });

  it('canon renders when positions and dependencies', () => {
    const bible = bibleOf([
      fact({ entityId: 'fire', attribute: 'when', value: { season: 2, episode: 3, order: 1 } }),
      fact({ entityId: 'flood', attribute: 'When', value: { season: 1 } }),
      fact({ entityId: 'flood', attribute: 'Cause', value: 'rain' }),
    ], [{ id: 'd1', eventId: 'fire', afterEventId: 'flood' }]);
    expect(buildCanonText(entities, bible)).toBe([
      '### The Fire (Event)',
      '- when: Season 2, episode 3, order 1',
      '- comes after: The Flood',
      '',
      '### The Flood (Event)',
      '- Cause: rain',
      '- When: Season 1',
    ].join('\n'));
  });

  it('canon marks unresolved kept conflicts', () => {
    const bible = bibleOf([
      fact({ attribute: 'Eyes', value: 'green' }),
      fact({ attribute: 'eyes ', value: 'Green' }),
      fact({ attribute: 'Eyes', value: 'brown' }),
      fact({ attribute: 'Eyes', value: 'blue', status: 'proposed' }),
    ]);
    expect(buildCanonText(entities, bible)).toBe('### Mara (Character)\n- Eyes: unresolved: green or brown');
  });

  it('canon lists acknowledged kept conflicts as kept versions', () => {
    const green = fact({ attribute: 'Eyes', value: 'green' });
    const brown = fact({ attribute: 'Eyes', value: 'brown' });
    const decision: Decision = {
      id: 'k1', entityId: 'mara', attribute: 'eyes', kind: 'kept_all', factIds: [brown.id, green.id], setAsideIds: [],
      note: 'Heterochromia,\n one of each', at: 'T1',
    };
    const bible = { ...bibleOf([green, brown]), decisions: [decision] };
    expect(buildCanonText(entities, bible)).toBe([
      '### Mara (Character)',
      '- Eyes: green',
      '- Eyes: brown',
      '  (multiple versions kept: Heterochromia, one of each)',
    ].join('\n'));
    const noNote = { ...bible, decisions: [{ ...decision, note: undefined }] };
    expect(buildCanonText(entities, noNote)).toContain('- Eyes: brown\n  (multiple versions kept)');
    // A new proposed version reopens the conflict, so the kept versions are unresolved again.
    const reopened = { ...bible, facts: [...bible.facts, fact({ attribute: 'Eyes', value: 'grey', status: 'proposed' })] };
    expect(buildCanonText(entities, reopened)).toBe('### Mara (Character)\n- Eyes: unresolved: green or brown');
  });
});

describe('buildAttachmentsText', () => {
  const items = [
    node('notes', 'folder', { title: 'Notes', order: 0 }),
    node('b', 'document', { title: 'Second', parentId: 'notes', order: 2 }),
    node('a', 'document', { title: 'First', parentId: 'notes', order: 1 }),
    node('sub', 'folder', { title: 'Sub', parentId: 'notes', order: 3 }),
    node('pic', 'image', { title: 'Map', parentId: 'sub', order: 0, synopsis: 'A hand-drawn map' }),
    node('talk', 'ai-chat', { title: 'Ask', order: 1 }),
  ];
  const bodies: Record<string, string> = { a: 'alpha body', b: 'beta body', pic: 'ignored' };
  const contentOf = (id: string) => bodies[id];

  it('folder attachment expands to its documents', () => {
    const r = buildAttachmentsText(['notes', 'a'], items, contentOf);
    expect(r.missing).toEqual([]);
    expect(r.text).toBe([
      '### First (Document)\nalpha body',
      '### Second (Document)\nbeta body',
      '### Map (Image)\nA hand-drawn map',
    ].join('\n\n'));
  });

  it('includes an AI chat as its plain transcript', () => {
    const t = chat([msg('u', 'user', 'Hi'), msg('r', 'assistant', 'Hello', { model: 'm1' })]);
    const r = buildAttachmentsText(['talk'], items, contentOf, id => (id === 'talk' ? t : undefined));
    expect(r.text).toBe('### Ask (AI Chat)\nYou: Hi\n\nAI (m1): Hello');
  });

  it('a chat never attaches its own transcript', () => {
    const inFolder = items.map(i => (i.id === 'talk' ? { ...i, parentId: 'notes', order: 9 } : i));
    const t = chat([msg('u', 'user', 'Hi')]);
    const r = buildAttachmentsText(['notes', 'talk'], inFolder, contentOf, () => t, 'talk');
    expect(r.text).not.toContain('### Ask');
    expect(r.missing).toEqual([]);
    const req = buildChatRequest({
      transcript: chat([], { attachments: ['notes'] }), uptoIndex: 0, items: inFolder, bible: emptyBible(),
      contentOf, chatOf: () => t, chatId: 'talk', caps: ALL,
    });
    expect(req.system).toContain('### First (Document)');
    expect(req.system).not.toContain('### Ask');
  });

  it('deleted attachment is reported missing', () => {
    const r = buildAttachmentsText(['gone', 'a'], items, contentOf);
    expect(r.missing).toEqual(['gone']);
    expect(r.text).toBe('### First (Document)\nalpha body');
  });
});

describe('buildChatRequest', () => {
  const history = [
    msg('u1', 'user', 'one'),
    msg('a1', 'assistant', 'reply one', { status: 'complete' }),
    msg('u2', 'user', 'two'),
    msg('a2', 'assistant', '', { status: 'error', error: { code: 'X', message: 'x' } }),
    msg('u3', 'user', 'three'),
    msg('a3', 'assistant', 'partial', { status: 'cancelled' }),
    msg('u4', 'user', 'four'),
    msg('a4', 'assistant', '', { status: 'streaming' }),
  ];
  const base = {
    items: entities, bible: bibleOf([fact()]), contentOf: () => undefined, caps: ALL,
  };

  it('never sends providerExtras (search suggestions) to a model', () => {
    const extra = msg('a1', 'assistant', 'grounded', {
      status: 'complete', providerExtras: { gemini: { searchEntryPointHtml: '<div>SUGGEST</div>' } },
    });
    const req = buildChatRequest({ ...base, transcript: chat([msg('u1', 'user', 'q'), extra, msg('u2', 'user', 'next')]), uptoIndex: 3 });
    expect(JSON.stringify(req)).not.toContain('SUGGEST');
    expect(req.messages.map(m => Object.keys(m).sort())).toEqual([['role', 'text'], ['role', 'text'], ['role', 'text']]);
  });

  it('assembles system, canon, attachments and history', () => {
    const items = [...entities, node('doc', 'document', { title: 'Plan' })];
    const req = buildChatRequest({
      ...base, items, contentOf: () => 'the plan',
      transcript: chat(history, { attachments: ['doc'], temperature: 0.3, webSearch: true }),
      uptoIndex: history.length,
    });
    expect(req.provider).toBe('anthropic');
    expect(req.model).toBe('claude-x');
    expect(req.system).toBe([
      'You are helpful.',
      VRS_PREAMBLE,
      '## Canon\n\n### Mara (Character)\n- Eyes: green',
      '## Attached documents\n\n### Plan (Document)\nthe plan',
    ].join('\n\n'));
    expect(req.messages).toEqual([
      { role: 'user', text: 'one' },
      { role: 'assistant', text: 'reply one' },
      { role: 'user', text: 'two' },
      { role: 'user', text: 'three' },
      { role: 'assistant', text: 'partial' },
      { role: 'user', text: 'four' },
    ]);
    expect(req.temperature).toBe(0.3);
    expect(req.webSearch).toBe(true);
    expect(req.readUrls).toBe(false);
    expect(estimateTokens(req)).toBe(Math.ceil((req.system.length + 'onereply onetwothreepartialfour'.length) / 4));
  });

  it('omits empty canon and attachment sections', () => {
    const req = buildChatRequest({ ...base, bible: emptyBible(), transcript: chat([]), uptoIndex: 0 });
    expect(req.system).toBe(`You are helpful.\n\n${VRS_PREAMBLE}`);
  });

  it('resubmit history stops before the message', () => {
    const req = buildChatRequest({ ...base, transcript: chat(history), uptoIndex: 2 });
    expect(req.messages).toEqual([{ role: 'user', text: 'one' }, { role: 'assistant', text: 'reply one' }]);
  });

  it('toggles are off when the model lacks the capability', () => {
    const req = buildChatRequest({
      ...base, caps: NONE, transcript: chat([], { webSearch: true, readUrls: true }), uptoIndex: 0,
    });
    expect(req.webSearch).toBe(false);
    expect(req.readUrls).toBe(false);
  });

  it('temperature omitted when unsupported', () => {
    const unsupported = buildChatRequest({ ...base, caps: NONE, transcript: chat([], { temperature: 0.9 }), uptoIndex: 0 });
    expect('temperature' in unsupported).toBe(false);
    const unset = buildChatRequest({ ...base, transcript: chat([], { temperature: null }), uptoIndex: 0 });
    expect('temperature' in unset).toBe(false);
  });

  it('deterministic output', () => {
    const args = { ...base, transcript: chat(history, { attachments: ['fire'] }), uptoIndex: 4 };
    expect(JSON.stringify(buildChatRequest(args))).toBe(JSON.stringify(buildChatRequest(args)));
  });
});
