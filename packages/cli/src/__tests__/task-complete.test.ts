import { describe, it, expect, vi, beforeEach } from 'vitest';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { taskCompleteCommand } from '../commands/task-complete.js';
import { captureOutput, jsonResponse } from './test-helpers.js';

beforeEach(() => {
  vi.restoreAllMocks();
});

const SAMPLE_RESPONSE = {
  task: {
    id: 'task-1',
    processInstanceId: 'run-1',
    stepId: 'review',
    assignedRole: 'reviewer',
    assignedUserId: 'user-42',
    status: 'completed',
    deadline: null,
    createdAt: '2026-05-27T10:00:00.000Z',
    updatedAt: '2026-05-27T11:00:00.000Z',
    completedAt: '2026-05-27T11:00:00.000Z',
    completionData: { kind: 'verdict', verdict: 'approve' },
  },
  run: {
    id: 'run-1',
    definitionName: 'wf',
    definitionVersion: '1',
    status: 'running',
    namespace: 'ns',
    currentStepId: 'next-step',
    error: null,
    variables: {},
    triggerType: 'manual',
    triggerPayload: {},
    pauseReason: null,
    createdAt: '2026-05-27T09:00:00.000Z',
    updatedAt: '2026-05-27T11:00:00.000Z',
    createdBy: 'user-42',
    archived: false,
  },
};

describe('task complete command', () => {
  it('completes with inline --payload verdict and sends JSON body', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(SAMPLE_RESPONSE));
    const output = captureOutput();
    const code = await taskCompleteCommand({
      argv: ['task-1', '--payload', '{"kind":"verdict","verdict":"approve"}'],
      env: { MEDIFORCE_API_KEY: 'k' },
      output,
    });
    expect(code).toBe(0);
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toMatch(/\/api\/tasks\/task-1\/complete$/);
    expect(init?.method).toBe('POST');
    const body = JSON.parse(init?.body as string) as { kind: string; verdict: string };
    expect(body).toEqual({ kind: 'verdict', verdict: 'approve' });
    expect(output.stdoutLines.join('\n')).toMatch(/Task task-1 completed/);
  });

  it('completes with --payload-file from a file', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'task-complete-'));
    const path = join(dir, 'payload.json');
    writeFileSync(path, '{"kind":"verdict","verdict":"reject","comment":"missing data"}');
    try {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(SAMPLE_RESPONSE));
      const output = captureOutput();
      const code = await taskCompleteCommand({
        argv: ['task-1', '--payload-file', path],
        env: { MEDIFORCE_API_KEY: 'k' },
        output,
      });
      expect(code).toBe(0);
      const body = JSON.parse(
        vi.mocked(globalThis.fetch).mock.calls[0]![1]?.body as string,
      ) as { verdict: string };
      expect(body.verdict).toBe('reject');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('completes with --payload-file - reading from stdin', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(SAMPLE_RESPONSE));
    const output = captureOutput();
    const code = await taskCompleteCommand({
      argv: ['task-1', '--payload-file', '-'],
      env: { MEDIFORCE_API_KEY: 'k' },
      output,
      stdin: async () => '{"kind":"verdict","verdict":"approve"}',
    });
    expect(code).toBe(0);
  });

  it('exits 2 when no payload flag is provided', async () => {
    const output = captureOutput();
    const code = await taskCompleteCommand({
      argv: ['task-1'],
      env: { MEDIFORCE_API_KEY: 'k' },
      output,
    });
    expect(code).toBe(2);
    expect(output.stderrLines.join('\n')).toMatch(/--payload or --payload-file/);
  });

  it('exits 2 when both payload flags are provided', async () => {
    const output = captureOutput();
    const code = await taskCompleteCommand({
      argv: ['task-1', '--payload', '{}', '--payload-file', 'x.json'],
      env: { MEDIFORCE_API_KEY: 'k' },
      output,
    });
    expect(code).toBe(2);
    expect(output.stderrLines.join('\n')).toMatch(/mutually exclusive/);
  });

  it('exits 1 on invalid JSON payload', async () => {
    const output = captureOutput();
    const code = await taskCompleteCommand({
      argv: ['task-1', '--payload', 'not-json'],
      env: { MEDIFORCE_API_KEY: 'k' },
      output,
    });
    expect(code).toBe(1);
    expect(output.stderrLines.join('\n')).toMatch(/invalid JSON/);
  });

  it('exits 1 on payload that does not match CompleteHumanTaskPayload shape', async () => {
    const output = captureOutput();
    const code = await taskCompleteCommand({
      argv: ['task-1', '--payload', '{"kind":"verdict"}'],
      env: { MEDIFORCE_API_KEY: 'k' },
      output,
    });
    expect(code).toBe(1);
    expect(output.stderrLines.join('\n')).toMatch(/invalid payload shape/);
  });
});
