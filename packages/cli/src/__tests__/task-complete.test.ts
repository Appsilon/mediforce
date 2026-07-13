import { describe, it, expect, vi, beforeEach } from 'vitest';
import { taskCompleteCommand } from '../commands/task-complete';
import { captureOutput, jsonResponse } from './test-helpers';

beforeEach(() => {
  vi.restoreAllMocks();
});

const BASE_ENV = { MEDIFORCE_API_KEY: 'k' };

const COMPLETE_RESPONSE = {
  task: {
    id: 'task-1',
    processInstanceId: 'run-1',
    stepId: 'step-review',
    assignedRole: 'reviewer',
    assignedUserId: null,
    status: 'completed',
    deadline: null,
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
    completedAt: '2026-06-01T00:01:00.000Z',
    completionData: { kind: 'verdict', verdict: 'approve' },
  },
  run: {
    id: 'run-1',
    definitionName: 'wf-a',
    definitionVersion: '1',
    status: 'running',
    currentStepId: null,
    variables: {},
    triggerType: 'manual',
    triggerPayload: {},
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
    createdBy: 'test',
    pauseReason: null,
    error: null,
    assignedRoles: [],
    deleted: false,
    archived: false,
    dryRun: false,
    namespace: 'test',
  },
};

describe('task complete command', () => {
  it('prints help on --help', async () => {
    const output = captureOutput();
    const code = await taskCompleteCommand({ argv: ['--help'], env: BASE_ENV, output });
    expect(code).toBe(0);
    expect(output.stdoutLines.join('\n')).toMatch(/payload/i);
  });

  it('exits 2 when no payload provided', async () => {
    const output = captureOutput();
    const code = await taskCompleteCommand({
      argv: ['task-1', '--base-url', 'http://test:9000'],
      env: BASE_ENV,
      output,
    });
    expect(code).toBe(2);
    expect(output.stderrLines.join('\n')).toMatch(/--payload|--payload-file/);
  });

  it('exits 2 when both --payload and --payload-file given', async () => {
    const output = captureOutput();
    const code = await taskCompleteCommand({
      argv: ['task-1', '--payload', '{}', '--payload-file', 'f.json'],
      env: BASE_ENV,
      output,
    });
    expect(code).toBe(2);
    expect(output.stderrLines.join('\n')).toMatch(/mutually exclusive/);
  });

  it('exits 2 on invalid JSON payload', async () => {
    const output = captureOutput();
    const code = await taskCompleteCommand({
      argv: ['task-1', '--payload', '{bad'],
      env: BASE_ENV,
      output,
    });
    expect(code).toBe(2);
    expect(output.stderrLines.join('\n')).toMatch(/not valid JSON/);
  });

  it('completes task with inline --payload', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse(COMPLETE_RESPONSE),
    );
    const output = captureOutput();
    const code = await taskCompleteCommand({
      argv: ['task-1', '--payload', '{"kind":"verdict","verdict":"approve"}', '--base-url', 'http://test:9000'],
      env: BASE_ENV,
      output,
    });
    expect(code).toBe(0);
    expect(output.stdoutLines.join('\n')).toMatch(/task-1.*completed/i);
    const body = JSON.parse(fetchSpy.mock.calls[0]![1]?.body as string);
    expect(body).toEqual({ kind: 'verdict', verdict: 'approve' });
  });

  it('reads payload from stdin via --payload-file -', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse(COMPLETE_RESPONSE),
    );
    const output = captureOutput();
    const code = await taskCompleteCommand({
      argv: ['task-1', '--payload-file', '-', '--base-url', 'http://test:9000'],
      env: BASE_ENV,
      output,
      stdin: async () => '{"kind":"verdict","verdict":"ok"}',
    });
    expect(code).toBe(0);
    const body = JSON.parse(fetchSpy.mock.calls[0]![1]?.body as string);
    expect(body).toEqual({ kind: 'verdict', verdict: 'ok' });
  });

  it('outputs JSON on --json', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse(COMPLETE_RESPONSE),
    );
    const output = captureOutput();
    const code = await taskCompleteCommand({
      argv: ['task-1', '--payload', '{"kind":"verdict","verdict":"done"}', '--json', '--base-url', 'http://test:9000'],
      env: BASE_ENV,
      output,
    });
    expect(code).toBe(0);
    const parsed = JSON.parse(output.stdoutLines[0]!);
    expect(parsed.task.id).toBe('task-1');
    expect(parsed.task.status).toBe('completed');
  });
});
