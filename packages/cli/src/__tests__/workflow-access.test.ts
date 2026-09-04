import { describe, it, expect, vi, beforeEach } from 'vitest';
import { workflowAccessCommand, workflowSetAccessCommand } from '../commands/workflow-access';
import { captureOutput, jsonResponse } from './test-helpers';

beforeEach(() => {
  vi.restoreAllMocks();
});

const BASE_ENV = { MEDIFORCE_API_KEY: 'k' };

const ACCESS = {
  namespace: 'krystian-zielinski',
  name: 'tealflow',
  access: { run: ['reviewer'], edit: ['approver'] },
  caller: { mayRun: true, mayEdit: false },
};

describe('workflow access command', () => {
  it('prints both gates and what they mean for the caller', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(ACCESS));
    const output = captureOutput();

    const code = await workflowAccessCommand({
      argv: ['tealflow', '--namespace', 'krystian-zielinski'],
      env: BASE_ENV,
      output,
    });

    expect(code).toBe(0);
    const text = output.stdoutLines.join('\n');
    expect(text).toMatch(/Access for krystian-zielinski\/tealflow/);
    expect(text).toMatch(/run:\s+reviewer/);
    expect(text).toMatch(/edit:\s+approver/);
    expect(text).toMatch(/you may edit:\s+no/);
  });

  it('spells out that an empty gate is open rather than printing nothing', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({ ...ACCESS, access: { run: [], edit: [] } }),
    );
    const output = captureOutput();

    await workflowAccessCommand({
      argv: ['tealflow', '--namespace', 'krystian-zielinski'],
      env: BASE_ENV,
      output,
    });

    expect(output.stdoutLines.join('\n')).toMatch(/run:\s+any workspace member/);
  });
});

describe('workflow set-access command', () => {
  it('PUTs both lists as one full replace', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(ACCESS));
    const output = captureOutput();

    const code = await workflowSetAccessCommand({
      argv: [
        'tealflow',
        '--namespace',
        'krystian-zielinski',
        '--run',
        'reviewer, reviewer',
        '--edit',
        'approver',
      ],
      env: BASE_ENV,
      output,
    });

    expect(code).toBe(0);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/api/workflow-definitions/tealflow/access');
    expect(url).toContain('namespace=krystian-zielinski');
    expect(init.method).toBe('PUT');
    // Repeated roles collapse — the gate counts distinct roles, so the wire
    // should too.
    expect(JSON.parse(init.body as string)).toEqual({
      access: { run: ['reviewer'], edit: ['approver'] },
    });
  });

  it('reads --run "" as "any workspace member", not as "leave it alone"', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(jsonResponse({ ...ACCESS, access: { run: [], edit: ['approver'] } }));
    const output = captureOutput();

    await workflowSetAccessCommand({
      argv: ['tealflow', '--namespace', 'krystian-zielinski', '--run', '', '--edit', 'approver'],
      env: BASE_ENV,
      output,
    });

    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({
      access: { run: [], edit: ['approver'] },
    });
    expect(output.stdoutLines.join('\n')).toMatch(/run:\s+any workspace member/);
  });
});
