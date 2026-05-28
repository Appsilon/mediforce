import { describe, it, expect, vi, beforeEach } from 'vitest';
import { taskListCommand } from '../commands/task-list.js';
import { captureOutput, jsonResponse } from './test-helpers.js';

beforeEach(() => {
  vi.restoreAllMocks();
});

const SAMPLE_TASKS = {
  tasks: [
    {
      id: 'task-1',
      processInstanceId: 'run-1',
      stepId: 'review',
      assignedRole: 'reviewer',
      assignedUserId: null,
      status: 'pending',
      deadline: null,
      createdAt: '2026-05-27T10:00:00.000Z',
      updatedAt: '2026-05-27T10:00:00.000Z',
      completedAt: null,
      completionData: null,
    },
  ],
};

describe('task list command', () => {
  it('GETs /api/tasks with instanceId filter', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(SAMPLE_TASKS));
    const output = captureOutput();
    const code = await taskListCommand({
      argv: ['--instance', 'run-1'],
      env: { MEDIFORCE_API_KEY: 'k' },
      output,
    });
    expect(code).toBe(0);
    const url = fetchSpy.mock.calls[0]?.[0] as string;
    expect(url).toMatch(/\/api\/tasks/);
    expect(url).toMatch(/instanceId=run-1/);
    expect(output.stdoutLines.join('\n')).toMatch(/task-1/);
  });

  it('GETs /api/tasks with role filter and status array', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ tasks: [] }));
    const output = captureOutput();
    await taskListCommand({
      argv: ['--role', 'reviewer', '--status', 'pending,claimed'],
      env: { MEDIFORCE_API_KEY: 'k' },
      output,
    });
    const url = fetchSpy.mock.calls[0]?.[0] as string;
    expect(url).toMatch(/role=reviewer/);
    expect(url).toMatch(/status=pending/);
    expect(url).toMatch(/status=claimed/);
  });

  it('exits 2 when neither --instance nor --role is provided', async () => {
    const output = captureOutput();
    const code = await taskListCommand({
      argv: [],
      env: { MEDIFORCE_API_KEY: 'k' },
      output,
    });
    expect(code).toBe(2);
    expect(output.stderrLines.join('\n')).toMatch(/exactly one of --instance or --role/i);
  });

  it('exits 2 when both --instance and --role are provided', async () => {
    const output = captureOutput();
    const code = await taskListCommand({
      argv: ['--instance', 'run-1', '--role', 'reviewer'],
      env: { MEDIFORCE_API_KEY: 'k' },
      output,
    });
    expect(code).toBe(2);
  });

  it('exits 2 on invalid --status value', async () => {
    const output = captureOutput();
    const code = await taskListCommand({
      argv: ['--role', 'reviewer', '--status', 'bogus'],
      env: { MEDIFORCE_API_KEY: 'k' },
      output,
    });
    expect(code).toBe(2);
    expect(output.stderrLines.join('\n')).toMatch(/Invalid --status/);
  });

  it('emits JSON when --json is set', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(SAMPLE_TASKS));
    const output = captureOutput();
    await taskListCommand({
      argv: ['--instance', 'run-1', '--json'],
      env: { MEDIFORCE_API_KEY: 'k' },
      output,
    });
    const parsed = JSON.parse(output.stdoutLines.join('\n')) as { tasks: unknown[] };
    expect(parsed.tasks.length).toBe(1);
  });

  it('prints "No tasks found" for empty result', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ tasks: [] }));
    const output = captureOutput();
    const code = await taskListCommand({
      argv: ['--instance', 'run-1'],
      env: { MEDIFORCE_API_KEY: 'k' },
      output,
    });
    expect(code).toBe(0);
    expect(output.stdoutLines.join('\n')).toMatch(/No tasks found/);
  });
});
