import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runFilesCommand } from '../commands/run-files';
import { captureOutput, jsonResponse } from './test-helpers';

beforeEach(() => {
  vi.restoreAllMocks();
});

const BASE_ENV = { MEDIFORCE_API_KEY: 'k' };

const TWO_STEP_LISTING = {
  files: [
    {
      stepId: 'extract',
      name: 'report.pdf',
      path: '.mediforce/output/extract/report.pdf',
      size: 2048,
    },
    {
      stepId: 'extract',
      name: 'tables/ae.csv',
      path: '.mediforce/output/extract/tables/ae.csv',
      size: 17,
    },
    {
      stepId: 'summarize',
      name: 'summary.md',
      path: '.mediforce/output/summarize/summary.md',
      size: 300,
    },
  ],
};

// Size formatting is the shared @mediforce/platform-core formatBytes,
// tested in platform-core (src/utils/__tests__/format.test.ts).

describe('run files command', () => {
  it('exits 2 when no runId positional is given', async () => {
    const output = captureOutput();
    const code = await runFilesCommand({ argv: [], env: BASE_ENV, output });
    expect(code).toBe(2);
    expect(output.stderrLines.join('\n')).toMatch(
      /Missing required positional argument: RUNID/,
    );
  });

  it('GETs /api/runs/<runId>/files and prints files grouped by step', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(jsonResponse(TWO_STEP_LISTING));
    const output = captureOutput();
    const code = await runFilesCommand({
      argv: ['run-1', '--base-url', 'http://localhost:5555'],
      env: BASE_ENV,
      output,
    });
    expect(code).toBe(0);
    expect(fetchSpy.mock.calls[0]?.[0]).toBe('http://localhost:5555/api/runs/run-1/files');
    expect(output.stdoutLines).toEqual([
      'extract:',
      '  report.pdf  2.0 KB  .mediforce/output/extract/report.pdf',
      '  tables/ae.csv  17 B  .mediforce/output/extract/tables/ae.csv',
      'summarize:',
      '  summary.md  300 B  .mediforce/output/summarize/summary.md',
    ]);
  });

  it('prints a friendly message and exits 0 when the run has no files', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ files: [] }));
    const output = captureOutput();
    const code = await runFilesCommand({ argv: ['run-1'], env: BASE_ENV, output });
    expect(code).toBe(0);
    expect(output.stdoutLines).toEqual(['No output files.']);
  });

  it('emits the raw API response when --json is set', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(TWO_STEP_LISTING));
    const output = captureOutput();
    const code = await runFilesCommand({
      argv: ['run-1', '--json'],
      env: BASE_ENV,
      output,
    });
    expect(code).toBe(0);
    const parsed: unknown = JSON.parse(output.stdoutLines.join('\n'));
    expect(parsed).toEqual(TWO_STEP_LISTING);
  });

  it('exits 1 with structured error JSON on 404', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({ error: 'Run not found' }, 404),
    );
    const output = captureOutput();
    const code = await runFilesCommand({
      argv: ['nope', '--json'],
      env: BASE_ENV,
      output,
    });
    expect(code).toBe(1);
    const parsed: unknown = JSON.parse(output.stdoutLines.join('\n'));
    expect(parsed).toMatchObject({ status: 404 });
  });
});
