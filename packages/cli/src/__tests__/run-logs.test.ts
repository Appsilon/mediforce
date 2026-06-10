import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runLogsCommand } from '../commands/run-logs';
import { captureOutput, jsonResponse } from './test-helpers';

beforeEach(() => {
  vi.restoreAllMocks();
});

const BASE_ENV = { MEDIFORCE_API_KEY: 'k' };

const SAMPLE_STEPS = {
  steps: [
    {
      stepId: 'step-review',
      status: 'completed',
      execution: {
        status: 'completed',
        startedAt: '2026-06-01T10:00:00.000Z',
        completedAt: '2026-06-01T10:00:05.000Z',
        error: null,
        verdict: null,
      },
    },
    {
      stepId: 'step-approve',
      status: 'failed',
      execution: {
        status: 'failed',
        startedAt: '2026-06-01T10:00:06.000Z',
        completedAt: '2026-06-01T10:00:08.000Z',
        error: 'rejected by reviewer',
        verdict: 'reject',
      },
    },
  ],
};

const SAMPLE_EVENTS = {
  events: [
    { timestamp: '2026-06-01T10:00:00.000Z', action: 'run.started', description: 'Run started' },
    { timestamp: '2026-06-01T10:00:05.000Z', action: 'step.completed', description: 'step-review completed' },
  ],
};

describe('run logs command', () => {
  it('prints help on --help', async () => {
    const output = captureOutput();
    const code = await runLogsCommand({ argv: ['--help'], env: BASE_ENV, output });
    expect(code).toBe(0);
    expect(output.stdoutLines.join('\n')).toMatch(/logs|audit/i);
  });

  it('prints steps and audit events in text mode', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse(SAMPLE_EVENTS))
      .mockResolvedValueOnce(jsonResponse(SAMPLE_STEPS));

    const output = captureOutput();
    const code = await runLogsCommand({
      argv: ['run-1', '--base-url', 'http://test:9000'],
      env: BASE_ENV,
      output,
    });
    expect(code).toBe(0);
    const text = output.stdoutLines.join('\n');
    expect(text).toMatch(/step-review/);
    expect(text).toMatch(/step-approve/);
    expect(text).toMatch(/rejected by reviewer/);
    expect(text).toMatch(/reject/);
    expect(text).toMatch(/run\.started/);
    expect(text).toMatch(/5s/);
  });

  it('outputs JSON on --json', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse(SAMPLE_EVENTS))
      .mockResolvedValueOnce(jsonResponse(SAMPLE_STEPS));

    const output = captureOutput();
    const code = await runLogsCommand({
      argv: ['run-1', '--json', '--base-url', 'http://test:9000'],
      env: BASE_ENV,
      output,
    });
    expect(code).toBe(0);
    const parsed = JSON.parse(output.stdoutLines[0]!);
    expect(parsed.runId).toBe('run-1');
    expect(parsed.auditEvents).toHaveLength(2);
    expect(parsed.steps).toHaveLength(2);
  });
});
