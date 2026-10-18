import { describe, it, expect } from 'vitest';
import { createProjectApi } from '@/project/api';
import { createFakeBridge } from '@/test/fakeBridge';

describe('createProjectApi: readDoc', () => {
  it('reads CRLF and CR bodies with LF line endings and no BOM, as the editor shows them', async () => {
    const { bridge, fake } = createFakeBridge();
    fake.disk.docs = { crlf: '\uFEFFOne\r\nTwo\r\n\r\nThree', cr: 'A\rB' };
    const api = createProjectApi(bridge);
    expect(await api.readDoc('crlf')).toBe('One\nTwo\n\nThree');
    expect(await api.readDoc('cr')).toBe('A\nB');
  });

  it('leaves LF bodies unchanged', async () => {
    const { bridge, fake } = createFakeBridge();
    fake.disk.docs = { d: 'One\nTwo\n' };
    expect(await createProjectApi(bridge).readDoc('d')).toBe('One\nTwo\n');
  });
});
