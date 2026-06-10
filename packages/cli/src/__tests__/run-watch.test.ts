import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runWatchCommand } from '../commands/run-watch';
import { captureOutput, jsonResponse } from './test-helpers';

beforeEach(() => {
  vi.restoreAllMocks();
});

const BASE_ENV = { MEDIFORCE_API_KEY: 'k' };

function mkRun(status: string, opts: { currentStepId?: string; dryRun?: boolean; error?: string } = {}) {
  return {
    runId: 'run-1',
    definitionName: 'wf-a',
    status,
    currentStepId: opts.currentStepId ?? null,
    dryRun: opts.dryRun ?? false,
    error: opts.error ?? null,
  };
}

function mkSteps(steps: Array<{ stepId: string; status: string; error?: string }>) {
  return {
    steps: steps.map((s) => ({
      stepId: s.stepId,
      status: s.status,
      execution: { status: s.status, startedAt: null, completedAt: null, error: s.error ?? null },
    })),
  };
}

describe('run watch command', () => {
  it('prints help on --help', async () => {
    const output = captureOutput();
    const code = await runWatchCommand({ argv: ['--help'], env: BASE_ENV, output });
    expect(code).toBe(0);
    expect(output.stdoutLines.join('\n')).toMatch(/run-watch|Watch/i);
  });

  it('exits 0 when run is already completed', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse(mkRun('completed')))
      .mockResolvedValueOnce(jsonResponse(mkSteps([])));

    const output = captureOutput();
    const code = await runWatchCommand({
      argv: ['run-1', '--base-url', 'http://test:9000'],
      env: BASE_ENV,
      output,
    });
    expect(code).toBe(0);
    expect(output.stdoutLines.join('\n')).toMatch(/completed/);
  });

  it('exits 1 when run is failed', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse(mkRun('failed', { error: 'boom' })))
      .mockResolvedValueOnce(jsonResponse(mkSteps([])));

    const output = captureOutput();
    const code = await runWatchCommand({
      argv: ['run-1', '--base-url', 'http://test:9000'],
      env: BASE_ENV,
      output,
    });
    expect(code).toBe(1);
    expect(output.stdoutLines.join('\n')).toMatch(/failed/);
    expect(output.stdoutLines.join('\n')).toMatch(/boom/);
  });

  it('shows [DRY RUN] label for dry runs', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse(mkRun('completed', { dryRun: true })))
      .mockResolvedValueOnce(jsonResponse(mkSteps([])));

    const output = captureOutput();
    await runWatchCommand({
      argv: ['run-1', '--base-url', 'http://test:9000'],
      env: BASE_ENV,
      output,
    });
    expect(output.stdoutLines.join('\n')).toMatch(/DRY RUN/);
  });

  it('prints step status lines', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse(mkRun('completed')))
      .mockResolvedValueOnce(jsonResponse(mkSteps([
        { stepId: 'step-a', status: 'completed' },
        { stepId: 'step-b', status: 'failed', error: 'timeout' },
      ])));

    const output = captureOutput();
    await runWatchCommand({
      argv: ['run-1', '--base-url', 'http://test:9000'],
      env: BASE_ENV,
      output,
    });
    const text = output.stdoutLines.join('\n');
    expect(text).toMatch(/step-a/);
    expect(text).toMatch(/step-b/);
    expect(text).toMatch(/timeout/);
  });

  it('outputs JSON lines with --json', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse(mkRun('completed')))
      .mockResolvedValueOnce(jsonResponse(mkSteps([])));

    const output = captureOutput();
    await runWatchCommand({
      argv: ['run-1', '--json', '--base-url', 'http://test:9000'],
      env: BASE_ENV,
      output,
    });
    const statusLine = output.stdoutLines.find((l) => l.includes('"type"'));
    expect(statusLine).toBeDefined();
    const parsed = JSON.parse(statusLine!);
    expect(parsed.type).toBe('status');
    expect(parsed.status).toBe('completed');
  });
});
