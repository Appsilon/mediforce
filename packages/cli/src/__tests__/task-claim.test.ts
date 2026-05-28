import { describe, it, expect, vi, beforeEach } from 'vitest';
import { taskClaimCommand } from '../commands/task-claim.js';
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
    status: 'claimed',
    deadline: null,
    createdAt: '2026-05-27T10:00:00.000Z',
    updatedAt: '2026-05-27T10:05:00.000Z',
    completedAt: null,
    completionData: null,
  },
};

describe('task claim command', () => {
  it('POSTs /api/tasks/<id>/claim and prints assignee', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(SAMPLE_RESPONSE));
    const output = captureOutput();
    const code = await taskClaimCommand({
      argv: ['task-1'],
      env: { MEDIFORCE_API_KEY: 'k' },
      output,
    });
    expect(code).toBe(0);
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toMatch(/\/api\/tasks\/task-1\/claim$/);
    expect(init?.method).toBe('POST');
    expect(output.stdoutLines.join('\n')).toMatch(/Task task-1 claimed/);
    expect(output.stdoutLines.join('\n')).toMatch(/user-42/);
  });

  it('exits 2 when taskId is missing', async () => {
    const output = captureOutput();
    const code = await taskClaimCommand({
      argv: [],
      env: { MEDIFORCE_API_KEY: 'k' },
      output,
    });
    expect(code).toBe(2);
  });

  it('exits 1 on API error', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({ error: { code: 'conflict', message: 'already claimed' } }, 409),
    );
    const output = captureOutput();
    const code = await taskClaimCommand({
      argv: ['task-1', '--json'],
      env: { MEDIFORCE_API_KEY: 'k' },
      output,
    });
    expect(code).toBe(1);
    const parsed = JSON.parse(output.stdoutLines.join('\n')) as { status: number };
    expect(parsed.status).toBe(409);
  });
});
