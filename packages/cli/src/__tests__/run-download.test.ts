import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runDownloadCommand } from '../commands/run-download';
import { captureOutput, jsonResponse } from './test-helpers';

const BASE_ENV = { MEDIFORCE_API_KEY: 'k' };
const BASE_ARGS = ['--base-url', 'http://localhost:5555'];

const PDF_BYTES = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x00, 0xff, 0x80, 0xfe]);
const CSV_BYTES = new Uint8Array([0x67, 0x72, 0x61, 0x64, 0x65, 0x2c, 0x35, 0x0a]);

function binaryResponse(bytes: Uint8Array, fileName: string): Response {
  return new Response(bytes, {
    status: 200,
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${fileName}"`,
    },
  });
}

const TWO_STEP_LISTING = {
  files: [
    {
      stepId: 'extract',
      name: 'report.pdf',
      path: '.mediforce/output/extract/report.pdf',
      size: PDF_BYTES.length,
    },
    {
      stepId: 'grade',
      name: 'report.pdf',
      path: '.mediforce/output/grade/report.pdf',
      size: CSV_BYTES.length,
    },
  ],
};

function mockRunFilesApi(): void {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const url = String(input);
    if (url.endsWith('/api/runs/run-1/files')) {
      return jsonResponse(TWO_STEP_LISTING);
    }
    if (url.endsWith('/files/.mediforce/output/extract/report.pdf')) {
      return binaryResponse(PDF_BYTES, 'report.pdf');
    }
    if (url.endsWith('/files/.mediforce/output/grade/report.pdf')) {
      return binaryResponse(CSV_BYTES, 'report.pdf');
    }
    return jsonResponse({ error: `Unexpected URL: ${url}` }, 404);
  });
}

let tempDir: string;

beforeEach(async () => {
  vi.restoreAllMocks();
  tempDir = await mkdtemp(join(tmpdir(), 'mediforce-run-download-'));
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe('run download command', () => {
  it('exits 2 when no runId positional is given', async () => {
    const output = captureOutput();
    const code = await runDownloadCommand({ argv: [], env: BASE_ENV, output });
    expect(code).toBe(2);
    expect(output.stderrLines.join('\n')).toMatch(
      /Missing required positional argument: RUNID/,
    );
  });

  it('downloads a single file byte-identically to <outDir>/<fileName>', async () => {
    mockRunFilesApi();
    const output = captureOutput();
    const code = await runDownloadCommand({
      argv: [
        ...BASE_ARGS,
        'run-1',
        '.mediforce/output/extract/report.pdf',
        '--output',
        tempDir,
      ],
      env: BASE_ENV,
      output,
    });
    expect(code).toBe(0);
    const destination = join(tempDir, 'report.pdf');
    expect(output.stdoutLines).toEqual([destination]);
    const writtenBytes = new Uint8Array(await readFile(destination));
    expect(writtenBytes).toEqual(PDF_BYTES);
  });

  it('accepts -o as alias for --output', async () => {
    mockRunFilesApi();
    const output = captureOutput();
    const code = await runDownloadCommand({
      argv: [...BASE_ARGS, 'run-1', '.mediforce/output/extract/report.pdf', '-o', tempDir],
      env: BASE_ENV,
      output,
    });
    expect(code).toBe(0);
    const writtenBytes = new Uint8Array(await readFile(join(tempDir, 'report.pdf')));
    expect(writtenBytes).toEqual(PDF_BYTES);
  });

  it('downloads all files into per-step directories and prints a count', async () => {
    mockRunFilesApi();
    const output = captureOutput();
    const code = await runDownloadCommand({
      argv: [...BASE_ARGS, 'run-1', '--output', tempDir],
      env: BASE_ENV,
      output,
    });
    expect(code).toBe(0);
    const extractDestination = join(tempDir, 'extract', 'report.pdf');
    const gradeDestination = join(tempDir, 'grade', 'report.pdf');
    expect(output.stdoutLines).toEqual([
      extractDestination,
      gradeDestination,
      `Downloaded 2 file(s) to ${tempDir}`,
    ]);
    expect(new Uint8Array(await readFile(extractDestination))).toEqual(PDF_BYTES);
    expect(new Uint8Array(await readFile(gradeDestination))).toEqual(CSV_BYTES);
  });

  it('prints a friendly message and exits 0 when the run has no files', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ files: [] }));
    const output = captureOutput();
    const code = await runDownloadCommand({
      argv: [...BASE_ARGS, 'run-1', '--output', tempDir],
      env: BASE_ENV,
      output,
    });
    expect(code).toBe(0);
    expect(output.stdoutLines).toEqual(['No output files.']);
  });

  it('emits { written } JSON for download-all when --json is set', async () => {
    mockRunFilesApi();
    const output = captureOutput();
    const code = await runDownloadCommand({
      argv: [...BASE_ARGS, 'run-1', '--output', tempDir, '--json'],
      env: BASE_ENV,
      output,
    });
    expect(code).toBe(0);
    const parsed: unknown = JSON.parse(output.stdoutLines.join('\n'));
    expect(parsed).toEqual({
      written: [join(tempDir, 'extract', 'report.pdf'), join(tempDir, 'grade', 'report.pdf')],
    });
  });

  it('emits { written } JSON for a single-file download when --json is set', async () => {
    mockRunFilesApi();
    const output = captureOutput();
    const code = await runDownloadCommand({
      argv: [
        ...BASE_ARGS,
        'run-1',
        '.mediforce/output/grade/report.pdf',
        '--output',
        tempDir,
        '--json',
      ],
      env: BASE_ENV,
      output,
    });
    expect(code).toBe(0);
    const parsed: unknown = JSON.parse(output.stdoutLines.join('\n'));
    expect(parsed).toEqual({ written: [join(tempDir, 'report.pdf')] });
  });

  it('exits 1 with structured error JSON on 404', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({ error: 'Run not found' }, 404),
    );
    const output = captureOutput();
    const code = await runDownloadCommand({
      argv: [...BASE_ARGS, 'nope', '--output', tempDir, '--json'],
      env: BASE_ENV,
      output,
    });
    expect(code).toBe(1);
    const parsed: unknown = JSON.parse(output.stdoutLines.join('\n'));
    expect(parsed).toMatchObject({ status: 404 });
  });
});
