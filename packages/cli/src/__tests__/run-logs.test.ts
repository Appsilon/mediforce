import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runLogsCommand } from '../commands/run-logs';
import { captureOutput, jsonResponse } from './test-helpers';

beforeEach(() => {
  vi.restoreAllMocks();
});

const BASE_ENV = { MEDIFORCE_API_KEY: 'k' };

function mkAuditEvent(action: string, description: string, timestamp: string) {
  return {
    actorId: 'system',
    actorType: 'system',
    actorRole: '',
    action,
    description,
    timestamp,
    inputSnapshot: {},
    outputSnapshot: {},
    basis: 'workflow',
    entityType: 'run',
    entityId: 'run-1',
  };
}

function mkExecution(stepId: string, status: string, opts: { error?: string; verdict?: string; startedAt?: string; completedAt?: string } = {}) {
  return {
    id: `exec-${stepId}`,
    instanceId: 'run-1',
    stepId,
    status,
    input: {},
    output: null,
    verdict: opts.verdict ?? null,
    executedBy: 'system',
    startedAt: opts.startedAt ?? '2026-06-01T10:00:00.000Z',
    completedAt: opts.completedAt ?? null,
    iterationNumber: 0,
    gateResult: null,
    error: opts.error ?? null,
  };
}

const SAMPLE_STEPS = {
  instanceId: 'run-1',
  definitionName: 'wf-a',
  definitionVersion: '1',
  instanceStatus: 'completed' as const,
  currentStepId: null,
  steps: [
    {
      stepId: 'step-review',
      name: 'step-review',
      type: 'review' as const,
      executorType: 'human' as const,
      status: 'completed' as const,
      input: null,
      output: null,
      execution: mkExecution('step-review', 'completed', {
        startedAt: '2026-06-01T10:00:00.000Z',
        completedAt: '2026-06-01T10:00:05.000Z',
      }),
    },
    {
      stepId: 'step-approve',
      name: 'step-approve',
      type: 'review' as const,
      executorType: 'human' as const,
      status: 'completed' as const,
      input: null,
      output: null,
      execution: mkExecution('step-approve', 'failed', {
        startedAt: '2026-06-01T10:00:06.000Z',
        completedAt: '2026-06-01T10:00:08.000Z',
        error: 'rejected by reviewer',
        verdict: 'reject',
      }),
    },
  ],
};

const SAMPLE_EVENTS = {
  events: [
    mkAuditEvent('run.started', 'Run started', '2026-06-01T10:00:00.000Z'),
    mkAuditEvent('step.completed', 'step-review completed', '2026-06-01T10:00:05.000Z'),
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
