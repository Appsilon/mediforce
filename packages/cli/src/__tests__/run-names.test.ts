import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runNamesCommand } from '../commands/run-names';
import { captureOutput, jsonResponse } from './test-helpers';

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('run names command', () => {
  it('GETs /api/runs/names and prints id + definitionName per run', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({
        runs: [
          { id: 'r1', definitionName: 'wf-a' },
          { id: 'r2', definitionName: 'wf-b' },
        ],
      }),
    );
    const output = captureOutput();
    const code = await runNamesCommand({
      argv: ['--namespace', 'alpha', '--base-url', 'http://localhost:5555'],
      env: { MEDIFORCE_API_KEY: 'k' },
      output,
    });
    expect(code).toBe(0);
    expect(fetchSpy.mock.calls[0]?.[0]).toBe(
      'http://localhost:5555/api/runs/names?namespace=alpha',
    );
    const printed = output.stdoutLines.join('\n');
    expect(printed).toMatch(/r1\s+wf-a/);
    expect(printed).toMatch(/r2\s+wf-b/);
  });

  it('emits structured JSON when --json is set', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({ runs: [{ id: 'r1', definitionName: 'wf-a' }] }),
    );
    const output = captureOutput();
    const code = await runNamesCommand({
      argv: ['--namespace', 'alpha', '--json'],
      env: { MEDIFORCE_API_KEY: 'k' },
      output,
    });
    expect(code).toBe(0);
    const parsed: unknown = JSON.parse(output.stdoutLines.join('\n'));
    expect(parsed).toMatchObject({ runs: [{ id: 'r1', definitionName: 'wf-a' }] });
  });

  it('exits non-zero when --namespace is missing', async () => {
    const output = captureOutput();
    const code = await runNamesCommand({
      argv: [],
      env: { MEDIFORCE_API_KEY: 'k' },
      output,
    });
    expect(code).not.toBe(0);
  });

  it('prints a friendly message when there are no runs', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ runs: [] }));
    const output = captureOutput();
    const code = await runNamesCommand({
      argv: ['--namespace', 'alpha'],
      env: { MEDIFORCE_API_KEY: 'k' },
      output,
    });
    expect(code).toBe(0);
    expect(output.stdoutLines.join('\n')).toMatch(/No runs found/);
  });
});
