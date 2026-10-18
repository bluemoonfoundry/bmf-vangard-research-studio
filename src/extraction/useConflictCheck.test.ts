import { describe, expect, it } from 'vitest';
import { createElement, type ReactNode } from 'react';
import { act, render, waitFor } from '@testing-library/react';
import { createAiApi } from '@/ai/aiApi';
import { createProjectApi } from '@/project/api';
import { useProject, type ProjectController } from '@/project/useProject';
import type { Fact, TreeItem } from '@/project/types';
import { createFakeBridge, makeOpened } from '@/test/fakeBridge';
import { useConflictCheck, type ConflictCheckRun } from '@/extraction/useConflictCheck';

const node = (id: string, type: string, extra: Partial<TreeItem> = {}): TreeItem => ({ id, parentId: null, type, title: id, order: 0, keywords: [], ...extra });
const fact = (id: string, attribute: string, value: string): Fact =>
  ({ id, entityId: 'e1', attribute, value, status: 'kept', origin: 'manual', createdAt: 'T', updatedAt: 'T' });

async function setup() {
  const { bridge, fake } = createFakeBridge();
  const projectApi = createProjectApi(bridge);
  const ai = createAiApi(bridge);
  const box = {} as { project: ProjectController; check: ConflictCheckRun };
  function Host(): ReactNode {
    const project = useProject(projectApi, bridge.app);
    box.project = project;
    box.check = useConflictCheck({ ai, project });
    return null;
  }
  fake.nextDialogResult = makeOpened({
    tree: { items: [node('e1', 'entity', { entityKind: 'character', title: 'Mara' })] },
    bible: { facts: [fact('f1', 'age', '24'), fact('f2', 'born', '40 years before the story')], dependencies: [], decisions: [] },
  });
  render(createElement(Host));
  await act(() => box.project.openProject());
  return { fake, box };
}

describe('useConflictCheck', () => {
  it('sends the scope once and stores the flags', async () => {
    const { fake, box } = await setup();
    fake.ai.conflictResult = { conflicts: [{ a: 'F1', b: 'F2', reason: 'Ages disagree.' }], dropped: 0, model: 'm' };
    act(() => box.check.start(['e1'], 'gemini', 'm'));
    await waitFor(() => expect(box.check.status.state).toBe('done'));
    expect(fake.ai.conflictChecks).toHaveLength(1);
    expect(fake.ai.conflictChecks[0].request.text).toContain('F1 [kept] age: 24');
    expect(box.check.status).toMatchObject({ state: 'done', added: 1 });
    expect(box.project.state!.extraction.flags).toMatchObject([{ factIds: ['f1', 'f2'], reason: 'Ages disagree.' }]);
  });

  it('reports an error and changes nothing', async () => {
    const { fake, box } = await setup();
    fake.ai.conflictResult = () => { throw Object.assign(new Error('Slow down'), { code: 'RATE_LIMIT' }); };
    act(() => box.check.start(['e1'], 'gemini', 'm'));
    await waitFor(() => expect(box.check.status.state).toBe('error'));
    expect(box.check.status.message).toBe('Slow down');
    expect(box.project.state!.extraction.flags).toBeUndefined();
  });

  it('cancel stops waiting, tells the main process and applies nothing', async () => {
    const { fake, box } = await setup();
    let finish!: () => void;
    fake.ai.conflictResult = () => new Promise(resolve => {
      finish = () => resolve({ conflicts: [{ a: 'F1', b: 'F2', reason: 'r' }], dropped: 0, model: 'm' });
    });
    act(() => box.check.start(['e1'], 'gemini', 'm'));
    await waitFor(() => expect(fake.ai.conflictChecks).toHaveLength(1));
    act(() => box.check.cancel());
    await waitFor(() => expect(box.check.status.state).toBe('cancelled'));
    expect(fake.ai.cancelledConflictChecks).toEqual([fake.ai.conflictChecks[0].requestId]);
    finish();
    await new Promise(r => setTimeout(r, 0));
    expect(box.project.state!.extraction.flags).toBeUndefined();
  });

  it('does nothing for a scope without live facts', async () => {
    const { fake, box } = await setup();
    act(() => box.check.start(['nobody'], 'gemini', 'm'));
    expect(box.check.status).toMatchObject({ state: 'error', message: 'There are no facts to check.' });
    expect(fake.ai.conflictChecks).toHaveLength(0);
  });
});
