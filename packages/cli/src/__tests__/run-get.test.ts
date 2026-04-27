import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runGetCommand } from '../commands/run-get.js';
import { captureOutput, jsonResponse } from './test-helpers.js';

beforeEach(() => {
  vi.restoreAllMocks();
});

/**
 * NOTE: The live `GET /api/runs/<runId>` endpoint ships on the n8n-migrator
 * branch. Until that lands on `main`, these tests run only against fetch
 * loopback. See packages/platform-api/src/contract/runs.ts for the contract
 * comment with the same dependency note.
 */

describe('run get command', () => {
  it('exits 2 when no runId positional is given', async () => {
    const output = captureOutput();
    const code = await runGetCommand({
      argv: [],
      env: { MEDIFORCE_API_KEY: 'k' },
      output,
    });
    expect(code).toBe(2);
    expect(output.stderrLines.join('\n') + output.stdoutLines.join('\n')).toMatch(
      /runId is required/,
    );
  });

  it('GETs /api/runs/<runId> and prints the result', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({
        runId: 'run-1',
        status: 'completed',
        currentStepId: 'final',
        error: null,
        finalOutput: { ok: true },
      }),
    );
    const output = captureOutput();
    const code = await runGetCommand({
      argv: ['run-1', '--base-url', 'http://localhost:5555'],
      env: { MEDIFORCE_API_KEY: 'k' },
      output,
    });
    expect(code).toBe(0);
    expect(fetchSpy.mock.calls[0]?.[0]).toBe('http://localhost:5555/api/runs/run-1');
    expect(output.stdoutLines.join('\n')).toMatch(/run-1/);
    expect(output.stdoutLines.join('\n')).toMatch(/completed/);
  });

  it('emits structured JSON when --json is set', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({
        runId: 'run-2',
        status: 'running',
        currentStepId: 'mid',
        error: null,
        finalOutput: null,
      }),
    );
    const output = captureOutput();
    const code = await runGetCommand({
      argv: ['run-2', '--json'],
      env: { MEDIFORCE_API_KEY: 'k' },
      output,
    });
    expect(code).toBe(0);
    const parsed: unknown = JSON.parse(output.stdoutLines.join('\n'));
    expect(parsed).toMatchObject({ runId: 'run-2', status: 'running' });
  });

  it('exits 1 with structured error JSON on 404', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({ error: 'Run not found' }, 404),
    );
    const output = captureOutput();
    const code = await runGetCommand({
      argv: ['nope', '--json'],
      env: { MEDIFORCE_API_KEY: 'k' },
      output,
    });
    expect(code).toBe(1);
    const parsed: unknown = JSON.parse(output.stdoutLines.join('\n'));
    expect(parsed).toMatchObject({ status: 404 });
  });

  it('exits 2 when more than one positional is given', async () => {
    const output = captureOutput();
    const code = await runGetCommand({
      argv: ['run-1', 'run-2'],
      env: { MEDIFORCE_API_KEY: 'k' },
      output,
    });
    expect(code).toBe(2);
  });
});
