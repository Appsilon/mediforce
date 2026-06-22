import { describe, it, expect, vi, beforeEach } from 'vitest';
import { taskListCommand } from '../commands/task-list';
import { taskGetCommand } from '../commands/task-get';
import { taskClaimCommand } from '../commands/task-claim';
import { captureOutput, jsonResponse } from './test-helpers';

beforeEach(() => {
  vi.restoreAllMocks();
});

const SAMPLE_TASK = {
  id: 'task-1',
  processInstanceId: 'inst-a',
  stepId: 'step-review',
  assignedRole: 'reviewer',
  assignedUserId: null,
  status: 'pending',
  payload: {},
  createdAt: '2026-05-28T10:00:00.000Z',
  updatedAt: '2026-05-28T10:00:00.000Z',
  completedAt: null,
  deleted: false,
  deadline: null,
  completionData: null,
  cancelReason: null,
};

describe('task list command', () => {
  it('GETs /api/tasks with role filter and prints task rows', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ tasks: [SAMPLE_TASK] }));
    const output = captureOutput();
    const code = await taskListCommand({
      argv: ['--role', 'reviewer', '--base-url', 'http://localhost:5555'],
      env: { MEDIFORCE_API_KEY: 'k' },
      output,
    });
    expect(code).toBe(0);
    expect(fetchSpy.mock.calls[0]?.[0]).toMatch(/http:\/\/localhost:5555\/api\/tasks.*role=reviewer/);
    expect(output.stdoutLines.join('\n')).toMatch(/task-1/);
  });

  it('passes --instance-id + --step-id + --status as query params', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ tasks: [] }));
    await taskListCommand({
      argv: ['--instance-id', 'inst-a', '--step-id', 'step-review', '--status', 'pending'],
      env: { MEDIFORCE_API_KEY: 'k' },
      output: captureOutput(),
    });
    const url = fetchSpy.mock.calls[0]?.[0] as string;
    expect(url).toMatch(/instanceId=inst-a/);
    expect(url).toMatch(/stepId=step-review/);
    expect(url).toMatch(/status=pending/);
  });

  it('hits /api/tasks with no axis flag — caller-scope queue (GitHub-like default)', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ tasks: [SAMPLE_TASK] }));
    const output = captureOutput();
    const code = await taskListCommand({
      argv: [],
      env: { MEDIFORCE_API_KEY: 'k' },
      output,
    });
    expect(code).toBe(0);
    const url = fetchSpy.mock.calls[0]?.[0] as string;
    expect(url).toMatch(/\/api\/tasks(\?|$)/);
    expect(url).not.toMatch(/role=/);
    expect(url).not.toMatch(/instanceId=/);
  });

  it('exits 2 when both --role and --instance-id are given', async () => {
    const output = captureOutput();
    const code = await taskListCommand({
      argv: ['--role', 'reviewer', '--instance-id', 'inst-a'],
      env: { MEDIFORCE_API_KEY: 'k' },
      output,
    });
    expect(code).toBe(2);
  });
});

describe('task get command', () => {
  it('GETs /api/tasks/:taskId and prints the entity', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(SAMPLE_TASK));
    const output = captureOutput();
    const code = await taskGetCommand({
      argv: ['task-1'],
      env: { MEDIFORCE_API_KEY: 'k' },
      output,
    });
    expect(code).toBe(0);
    expect(fetchSpy.mock.calls[0]?.[0]).toMatch(/\/api\/tasks\/task-1/);
    expect(output.stdoutLines.join('\n')).toMatch(/Task task-1/);
  });
});

describe('task claim command', () => {
  it('POSTs /api/tasks/:taskId/claim and prints the claimed entity', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(jsonResponse({ task: { ...SAMPLE_TASK, status: 'claimed', assignedUserId: 'u-1' } }));
    const output = captureOutput();
    const code = await taskClaimCommand({
      argv: ['task-1'],
      env: { MEDIFORCE_API_KEY: 'k' },
      output,
    });
    expect(code).toBe(0);
    const [url, init] = fetchSpy.mock.calls[0] ?? [];
    expect(url).toMatch(/\/api\/tasks\/task-1\/claim/);
    expect((init as { method?: string } | undefined)?.method).toBe('POST');
    expect(output.stdoutLines.join('\n')).toMatch(/claimed/);
  });
});
