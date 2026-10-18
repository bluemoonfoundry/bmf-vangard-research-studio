import { describe, expect, it } from 'vitest';
import type { Capabilities } from '@/ai/types';
import { CHAT_PERSONAS, DEFAULT_PERSONA_ID } from '@/chat/personas';
import type { ChatTranscript } from '@/chat/types';
import {
  applyStreamEvent, beginResubmit, beginSend, deleteAfter, deleteBefore, deleteMessage, editMessageText,
  forPersistence, isStreaming, locateQuote, newTranscript, normalizeTranscript, transcriptPlainText, updateSettings,
} from '@/chat/transcript';

const ALL: Capabilities = { webSearch: true, readUrls: true, temperature: true };
const NONE: Capabilities = { webSearch: false, readUrls: false, temperature: false };
const fresh = () => newTranscript({ provider: 'anthropic', model: 'm1' });

function convo(turns: number): ChatTranscript {
  let t = fresh();
  for (let i = 1; i <= turns; i++) {
    t = beginSend(t, { text: `q${i}`, userId: `u${i}`, assistantId: `a${i}`, at: 'T', caps: ALL });
    t = applyStreamEvent(t, `a${i}`, { type: 'text', delta: `r${i}` });
    t = applyStreamEvent(t, `a${i}`, { type: 'done', model: 'm1' });
  }
  return t;
}

describe('newTranscript / normalizeTranscript', () => {
  it('uses defaults', () => {
    const t = fresh();
    expect(t.version).toBe(1);
    expect(t.settings).toMatchObject({
      provider: 'anthropic', model: 'm1', personaId: DEFAULT_PERSONA_ID, temperature: null,
      webSearch: false, readUrls: false, attachments: [], filterMode: 'all',
    });
    expect(t.settings.systemPrompt).toBeTruthy();
    expect(t.messages).toEqual([]);
  });
  it('fills missing settings and keeps unknown fields', () => {
    const t = normalizeTranscript({ version: 1, extra: 5, settings: { model: 'x', temperature: 0.3 }, messages: [] });
    expect(t.extra).toBe(5);
    expect(t.settings.model).toBe('x');
    expect(t.settings.temperature).toBe(0.3);
    expect(t.settings.filterMode).toBe('all');
    expect(t.settings.attachments).toEqual([]);
  });
  it('tolerates junk', () => {
    expect(normalizeTranscript(null).messages).toEqual([]);
    expect(normalizeTranscript({ messages: 'no' }).messages).toEqual([]);
  });
});

describe('beginSend', () => {
  it('appends user and pending assistant without mutating', () => {
    const t = fresh();
    const n = beginSend(t, { text: 'hi', userId: 'u', assistantId: 'a', at: 'T', caps: ALL });
    expect(t.messages).toHaveLength(0);
    expect(n.messages.map(m => [m.id, m.role])).toEqual([['u', 'user'], ['a', 'assistant']]);
    expect(n.messages[1]).toMatchObject({ status: 'streaming', text: '', provider: 'anthropic', model: 'm1' });
  });
  it('toggles are recorded only when the model supports them', () => {
    const on = updateSettings(fresh(), { webSearch: true, readUrls: true });
    const a = beginSend(on, { text: 'x', userId: 'u', assistantId: 'a', at: 'T', caps: ALL }).messages[1];
    const b = beginSend(on, { text: 'x', userId: 'u', assistantId: 'a', at: 'T', caps: NONE }).messages[1];
    expect([a.usedWebSearch, a.usedReadUrls]).toEqual([true, true]);
    expect([b.usedWebSearch, b.usedReadUrls]).toEqual([false, false]);
    const off = beginSend(fresh(), { text: 'x', userId: 'u', assistantId: 'a', at: 'T', caps: ALL }).messages[1];
    expect([off.usedWebSearch, off.usedReadUrls]).toEqual([false, false]);
  });
});

describe('beginResubmit', () => {
  it('resubmit drops every later message', () => {
    const t = convo(3);
    const five = { ...t, messages: t.messages.slice(0, 5) };
    const n = beginResubmit(five, { messageId: five.messages[2].id, assistantId: 'x', at: 'T', caps: ALL });
    expect(n.messages).toHaveLength(4);
    expect(n.messages.slice(0, 3).map(m => m.id)).toEqual(['u1', 'a1', 'u2']);
    expect(n.messages[3]).toMatchObject({ id: 'x', status: 'streaming' });
  });
  it('edit-and-resubmit marks edited only when the text changed', () => {
    const t = convo(2);
    const same = beginResubmit(t, { messageId: 'u2', text: 'q2', assistantId: 'x', at: 'T', caps: ALL });
    const diff = beginResubmit(t, { messageId: 'u2', text: 'new', assistantId: 'x', at: 'T', caps: ALL });
    const none = beginResubmit(t, { messageId: 'u2', assistantId: 'x', at: 'T', caps: ALL });
    expect(same.messages[2].edited).toBe(false);
    expect(none.messages[2].edited).toBe(false);
    expect(diff.messages[2]).toMatchObject({ text: 'new', edited: true });
  });
  it('ignores unknown or non-user ids', () => {
    const t = convo(1);
    expect(beginResubmit(t, { messageId: 'nope', assistantId: 'x', at: 'T', caps: ALL })).toBe(t);
    expect(beginResubmit(t, { messageId: 'a1', assistantId: 'x', at: 'T', caps: ALL })).toBe(t);
  });
});

describe('applyStreamEvent', () => {
  it('stream events fold into the pending message; done stamps the model', () => {
    let t = beginSend(fresh(), { text: 'q', userId: 'u', assistantId: 'a', at: 'T', caps: ALL });
    t = applyStreamEvent(t, 'a', { type: 'text', delta: 'Hel' });
    t = applyStreamEvent(t, 'a', { type: 'text', delta: 'lo' });
    t = applyStreamEvent(t, 'a', { type: 'sources', sources: [{ url: 'https://a' }, { url: 'https://b' }] });
    t = applyStreamEvent(t, 'a', { type: 'sources', sources: [{ url: 'https://b' }, { url: 'https://c' }] });
    t = applyStreamEvent(t, 'a', { type: 'extras', extras: { gemini: { searchEntryPointHtml: '<i/>' } } });
    t = applyStreamEvent(t, 'a', { type: 'done', model: 'm-final' });
    expect(t.messages[1]).toMatchObject({
      text: 'Hello', status: 'complete', model: 'm-final',
      providerExtras: { gemini: { searchEntryPointHtml: '<i/>' } },
    });
    expect(t.messages[1].sources?.map(s => s.url)).toEqual(['https://a', 'https://b', 'https://c']);
    expect(isStreaming(t)).toBe(false);
  });
  it('cancelled error keeps partial text', () => {
    let t = beginSend(fresh(), { text: 'q', userId: 'u', assistantId: 'a', at: 'T', caps: ALL });
    t = applyStreamEvent(t, 'a', { type: 'text', delta: 'part' });
    t = applyStreamEvent(t, 'a', { type: 'error', code: 'CANCELLED', message: 'stop' });
    expect(t.messages[1]).toMatchObject({ status: 'cancelled', text: 'part', error: null });
  });
  it('other errors record the error', () => {
    let t = beginSend(fresh(), { text: 'q', userId: 'u', assistantId: 'a', at: 'T', caps: ALL });
    t = applyStreamEvent(t, 'a', { type: 'error', code: 'RATE', message: 'slow down' });
    expect(t.messages[1]).toMatchObject({ status: 'error', error: { code: 'RATE', message: 'slow down' } });
  });
  it('events for an unknown message are ignored', () => {
    const t = convo(1);
    expect(applyStreamEvent(t, 'zzz', { type: 'text', delta: 'x' })).toBe(t);
  });
});

describe('edit and delete', () => {
  it('editMessageText marks edited', () => {
    const n = editMessageText(convo(1), 'a1', 'fixed');
    expect(n.messages[1]).toMatchObject({ text: 'fixed', edited: true });
  });
  it('deleteMessage removes one', () => {
    expect(deleteMessage(convo(2), 'u1').messages.map(m => m.id)).toEqual(['a1', 'u2', 'a2']);
  });
  it('deleteBefore/After keep the pivot message', () => {
    const t = convo(2);
    expect(deleteBefore(t, 'u2').messages.map(m => m.id)).toEqual(['u2', 'a2']);
    expect(deleteAfter(t, 'u1').messages.map(m => m.id)).toEqual(['u1']);
    expect(deleteBefore(t, 'nope')).toBe(t);
    expect(deleteAfter(t, 'nope')).toBe(t);
  });
});

describe('persistence and text', () => {
  it('forPersistence returns the same object when idle and converts streaming to cancelled otherwise', () => {
    const idle = convo(1);
    expect(forPersistence(idle)).toBe(idle);
    const busy = beginSend(idle, { text: 'q', userId: 'u', assistantId: 'a', at: 'T', caps: ALL });
    expect(isStreaming(busy)).toBe(true);
    const saved = forPersistence(busy);
    expect(saved).not.toBe(busy);
    expect(saved.messages[3].status).toBe('cancelled');
    expect(busy.messages[3].status).toBe('streaming');
  });
  it('transcriptPlainText', () => {
    expect(transcriptPlainText(convo(1))).toBe('You: q1\n\nAI (m1): r1');
  });
  it('locateQuote finds the first exact occurrence', () => {
    expect(locateQuote('abc abc', 'bc')).toEqual({ start: 1, end: 3 });
    expect(locateQuote('abc', 'x')).toBeNull();
    expect(locateQuote('abc', '')).toBeNull();
  });
});

describe('personas', () => {
  it('has the five ids and no prototype-project specifics', () => {
    expect(CHAT_PERSONAS.map(p => p.id)).toEqual([
      'historical_scholar', 'worldbuilding_architect', 'detective_consultant', 'linguistic_stylist', 'general_assistant',
    ]);
    expect(CHAT_PERSONAS.some(p => /Dover|1684|Sterling/.test(JSON.stringify(p)))).toBe(false);
  });
});
