import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runListCommand } from '../commands/run-list.js';
import { captureOutput, jsonResponse } from './test-helpers.js';

beforeEach(() => {
  vi.restoreAllMocks();
});

const SAMPLE_RUNS = {
  runs: [
    {
      runId: 'run-1',
      status: 'completed',
      definitionName: 'my-workflow',
      definitionVersion: '3',
      currentStepId: null,
      error: null,
      createdAt: '2026-04-30T10:00:00.000Z',
      updatedAt: '2026-04-30T10:05:00.000Z',
      createdBy: 'mediforce-cli',
    },
    {
      runId: 'run-2',
      status: 'failed',
      definitionName: 'my-workflow',
      definitionVersion: '2',
      currentStepId: 'step-a',
      error: 'something broke',
      createdAt: '2026-04-29T10:00:00.000Z',
      updatedAt: '2026-04-29T10:01:00.000Z',
      createdBy: 'user-1',
    },
  ],
};

describe('run list command', () => {
  it('GETs /api/runs and prints human-readable output', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse(SAMPLE_RUNS),
    );
    const output = captureOutput();
    const code = await runListCommand({
      argv: ['--base-url', 'http://localhost:5555'],
      env: { MEDIFORCE_API_KEY: 'k' },
      output,
    });
    expect(code).toBe(0);
    expect(fetchSpy.mock.calls[0]?.[0]).toMatch(/http:\/\/localhost:5555\/api\/runs/);
    const stdout = output.stdoutLines.join('\n');
    expect(stdout).toMatch(/run-1/);
    expect(stdout).toMatch(/completed/);
    expect(stdout).toMatch(/run-2/);
    expect(stdout).toMatch(/something broke/);
  });

  it('emits structured JSON when --json is set', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse(SAMPLE_RUNS),
    );
    const output = captureOutput();
    const code = await runListCommand({
      argv: ['--json'],
      env: { MEDIFORCE_API_KEY: 'k' },
      output,
    });
    expect(code).toBe(0);
    const parsed: unknown = JSON.parse(output.stdoutLines.join('\n'));
    expect(parsed).toMatchObject({ runs: expect.arrayContaining([expect.objectContaining({ runId: 'run-1' })]) });
  });

  it('passes --workflow filter as query param', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({ runs: [] }),
    );
    const output = captureOutput();
    await runListCommand({
      argv: ['--workflow', 'media-monitoring'],
      env: { MEDIFORCE_API_KEY: 'k' },
      output,
    });
    const url = fetchSpy.mock.calls[0]?.[0] as string;
    expect(url).toMatch(/workflow=media-monitoring/);
  });

  it('passes --status filter as query param', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({ runs: [] }),
    );
    const output = captureOutput();
    await runListCommand({
      argv: ['--status', 'running'],
      env: { MEDIFORCE_API_KEY: 'k' },
      output,
    });
    const url = fetchSpy.mock.calls[0]?.[0] as string;
    expect(url).toMatch(/status=running/);
  });

  it('exits 2 on invalid --status', async () => {
    const output = captureOutput();
    const code = await runListCommand({
      argv: ['--status', 'bogus'],
      env: { MEDIFORCE_API_KEY: 'k' },
      output,
    });
    expect(code).toBe(2);
    const allOutput = output.stderrLines.join('\n') + output.stdoutLines.join('\n');
    expect(allOutput).toMatch(/Invalid status/i);
  });

  it('prints "No runs found" for empty result', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({ runs: [] }),
    );
    const output = captureOutput();
    const code = await runListCommand({
      argv: [],
      env: { MEDIFORCE_API_KEY: 'k' },
      output,
    });
    expect(code).toBe(0);
    expect(output.stdoutLines.join('\n')).toMatch(/No runs found/);
  });

  it('exits 1 on API error', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({ error: 'Internal error' }, 500),
    );
    const output = captureOutput();
    const code = await runListCommand({
      argv: ['--json'],
      env: { MEDIFORCE_API_KEY: 'k' },
      output,
    });
    expect(code).toBe(1);
    const parsed: unknown = JSON.parse(output.stdoutLines.join('\n'));
    expect(parsed).toMatchObject({ status: 500 });
  });

  it('shows help on --help', async () => {
    const output = captureOutput();
    const code = await runListCommand({
      argv: ['--help'],
      env: { MEDIFORCE_API_KEY: 'k' },
      output,
    });
    expect(code).toBe(0);
    expect(output.stdoutLines.join('\n')).toMatch(/Usage: mediforce run list/);
  });
});
