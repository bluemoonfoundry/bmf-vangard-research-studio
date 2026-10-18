import { describe, expect, it } from 'vitest';
import { createElement, type ReactNode } from 'react';
import { act, render, waitFor } from '@testing-library/react';
import { createAiApi } from '@/ai/aiApi';
import type { ExtractResult, ModelInfo, RawProposal } from '@/ai/types';
import { createProjectApi } from '@/project/api';
import { useProject, type ProjectController } from '@/project/useProject';
import type { TreeItem } from '@/project/types';
import { formatTurns } from '@/chat/importFormats';
import { createFakeBridge, makeOpened } from '@/test/fakeBridge';
import { estimateRun, useExtraction, type ExtractionRun } from '@/extraction/useExtraction';

const MODEL: ModelInfo = { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', inputTokenLimit: 1_000_000, capabilities: { webSearch: true, readUrls: true, temperature: true } };
const node = (id: string, type: string, extra: Partial<TreeItem> = {}): TreeItem => ({ id, parentId: null, type, title: id, order: 0, keywords: [], ...extra });
const BODY = formatTurns([{ role: 'user', label: 'You', text: 'Mara has green eyes.' }, { role: 'model', label: 'Gemini', text: 'Lovely.' }]);
const said: RawProposal = {
  entity: { id: 'e1', name: 'Mara', kind: 'character', reason: '' }, attribute: 'eyes', value: 'green', strength: 'said',
  evidence: [{ quote: 'Mara has green eyes.', turn: 1 }], replaces: '',
};
const result = (proposals: RawProposal[], summary = ''): ExtractResult => ({ proposals, summary, dropped: 0, model: MODEL.id });

async function setup(docs: Record<string, string> = { s1: BODY }) {
  const { bridge, fake } = createFakeBridge();
  const projectApi = createProjectApi(bridge);
  const ai = createAiApi(bridge);
  const box = {} as { project: ProjectController; run: ExtractionRun };
  function Host(): ReactNode {
    const project = useProject(projectApi, bridge.app);
    box.project = project;
    box.run = useExtraction({ ai, project });
    return null;
  }
  fake.nextDialogResult = makeOpened({ tree: { items: [node('e1', 'entity', { entityKind: 'character', title: 'Mara' }), ...Object.keys(docs).map(id => node(id, 'chat', { importedFormat: 'aistudio-exporter-md' }))] } });
  fake.disk.docs = { ...docs };
  render(createElement(Host));
  await act(() => box.project.openProject());
  await act(() => box.project.loadAllDocs());
  await waitFor(() => expect(box.project.state!.docs.s1).toBeDefined());
  return { fake, box };
}

describe('useExtraction', () => {
  it('sends an uncached source once and applies its proposals', async () => {
    const { fake, box } = await setup();
    fake.ai.extractResult = result([said]);
    act(() => box.run.start(['s1'], 'gemini', MODEL));
    await waitFor(() => expect(box.run.running).toBe(false));
    expect(fake.ai.extractions).toHaveLength(1);
    expect(fake.ai.extractions[0].request).toMatchObject({ provider: 'gemini', model: MODEL.id });
    expect(fake.ai.extractions[0].request.text).toContain('[Turn 1 · You]\nMara has green eyes.');
    expect(box.project.state!.bible.facts).toMatchObject([{ entityId: 'e1', value: 'green', status: 'proposed', origin: 'ai' }]);
    expect(box.project.state!.extraction.runs).toMatchObject([{ itemId: 's1', provider: 'gemini', model: MODEL.id, proposals: [said] }]);
    expect(box.run.statuses).toMatchObject([{ itemId: 's1', state: 'done', summary: { facts: 1 } }]);
  });

  it('re-running an unchanged source uses the cache and adds nothing', async () => {
    const { fake, box } = await setup();
    fake.ai.extractResult = result([said]);
    act(() => box.run.start(['s1'], 'gemini', MODEL));
    await waitFor(() => expect(box.run.running).toBe(false));
    const bible = box.project.state!.bible;
    expect(estimateRun(box.project.state!, ['s1'], 'gemini', MODEL).cached).toBe(1);
    act(() => box.run.start(['s1'], 'gemini', MODEL));
    await waitFor(() => expect(box.run.statuses[0]?.state).toBe('cached'));
    expect(fake.ai.extractions).toHaveLength(1);
    expect(box.project.state!.bible).toBe(bible);
  });

  it('sends a long source in chunks, carrying the summary forward', async () => {
    const long = formatTurns([
      { role: 'user', label: 'You', text: `Mara has green eyes. ${'a'.repeat(3000)}` },
      { role: 'model', label: 'Gemini', text: 'b'.repeat(3000) },
    ]);
    const { fake, box } = await setup({ s1: long });
    fake.ai.extractResult = (_req, id) => result(id === fake.ai.extractions[0].requestId ? [said] : [], 'Mara: green eyes.');
    act(() => box.run.start(['s1'], 'gemini', { ...MODEL, inputTokenLimit: 1 }));
    await waitFor(() => expect(box.run.running).toBe(false));
    expect(fake.ai.extractions).toHaveLength(2);
    expect(fake.ai.extractions[1].request.text).toContain('part 2 of 2');
    expect(fake.ai.extractions[1].request.text).toContain('Mara: green eyes.');
    expect(box.project.state!.bible.facts).toHaveLength(1);
  });

  it('a cancel during a chunk sends no further chunk', async () => {
    const long = formatTurns([
      { role: 'user', label: 'You', text: `Mara has green eyes. ${'a'.repeat(3000)}` },
      { role: 'model', label: 'Gemini', text: 'b'.repeat(3000) },
    ]);
    const { fake, box } = await setup({ s1: long });
    fake.ai.extractResult = () => {
      box.run.cancel();
      return result([said]);
    };
    act(() => box.run.start(['s1'], 'gemini', { ...MODEL, inputTokenLimit: 1 }));
    await waitFor(() => expect(box.run.running).toBe(false));
    expect(fake.ai.extractions).toHaveLength(1);
    expect(box.run.statuses[0].state).toBe('cancelled');
    expect(box.project.state!.bible.facts).toEqual([]);
  });

  it('a failed request applies nothing and reports why', async () => {
    const { fake, box } = await setup();
    fake.ai.extractResult = () => { throw Object.assign(new Error('Slow down.'), { code: 'RATE_LIMIT' }); };
    const before = box.project.state!;
    act(() => box.run.start(['s1'], 'gemini', MODEL));
    await waitFor(() => expect(box.run.running).toBe(false));
    expect(box.run.statuses).toMatchObject([{ state: 'error', message: 'Slow down.' }]);
    expect(box.project.state!.bible).toBe(before.bible);
    expect(box.project.state!.extraction).toBe(before.extraction);
  });

  it('cancel stops the request in flight and the sources after it', async () => {
    const { fake, box } = await setup({ s1: BODY, s2: BODY });
    fake.ai.extractResult = () => new Promise<ExtractResult>(() => {});
    act(() => box.run.start(['s1', 's2'], 'gemini', MODEL));
    await waitFor(() => expect(fake.ai.extractions).toHaveLength(1));
    act(() => box.run.cancel());
    await waitFor(() => expect(box.run.running).toBe(false));
    expect(fake.ai.cancelledExtractions).toEqual([fake.ai.extractions[0].requestId]);
    expect(box.run.statuses.map(s => s.state)).toEqual(['cancelled', 'waiting']);
    expect(fake.ai.extractions).toHaveLength(1);
    expect(box.project.state!.bible.facts).toEqual([]);
  });
});
