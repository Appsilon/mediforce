import { describe, it, expect, vi, beforeEach } from 'vitest';
import { workflowArchiveCommand } from '../commands/workflow-archive.js';
import { captureOutput, jsonResponse } from './test-helpers.js';

beforeEach(() => {
  vi.restoreAllMocks();
});

const BASE_ENV = { MEDIFORCE_API_KEY: 'k' };
const BASE_ARGS = ['--base-url', 'http://localhost:1234'];

describe('workflow archive command', () => {
  it('prints help and exits 0 with --help', async () => {
    const output = captureOutput();
    const code = await workflowArchiveCommand({
      argv: ['--help'],
      env: BASE_ENV,
      output,
    });
    expect(code).toBe(0);
    expect(output.stdoutLines.join('\n')).toMatch(/Usage: mediforce workflow archive/);
  });

  it('exits 2 when <name> is missing', async () => {
    const output = captureOutput();
    const code = await workflowArchiveCommand({
      argv: [...BASE_ARGS, '--version', '1'],
      env: BASE_ENV,
      output,
    });
    expect(code).toBe(2);
    expect(output.stderrLines.join('\n')).toMatch(/<name> is required/);
  });

  it('exits 2 when neither --version nor --all provided', async () => {
    const output = captureOutput();
    const code = await workflowArchiveCommand({
      argv: [...BASE_ARGS, 'my-wf'],
      env: BASE_ENV,
      output,
    });
    expect(code).toBe(2);
    expect(output.stderrLines.join('\n')).toMatch(/Either --version.*or --all is required/);
  });

  it('exits 2 when both --version and --all provided', async () => {
    const output = captureOutput();
    const code = await workflowArchiveCommand({
      argv: [...BASE_ARGS, 'my-wf', '--version', '1', '--all'],
      env: BASE_ENV,
      output,
    });
    expect(code).toBe(2);
    expect(output.stderrLines.join('\n')).toMatch(/mutually exclusive/);
  });

  it('exits 2 for invalid --version (non-integer)', async () => {
    const output = captureOutput();
    const code = await workflowArchiveCommand({
      argv: [...BASE_ARGS, 'my-wf', '--version', 'abc'],
      env: BASE_ENV,
      output,
    });
    expect(code).toBe(2);
    expect(output.stderrLines.join('\n')).toMatch(/Invalid --version/);
  });

  it('exits 2 for invalid --version (zero)', async () => {
    const output = captureOutput();
    const code = await workflowArchiveCommand({
      argv: [...BASE_ARGS, 'my-wf', '--version', '0'],
      env: BASE_ENV,
      output,
    });
    expect(code).toBe(2);
    expect(output.stderrLines.join('\n')).toMatch(/Invalid --version/);
  });

  it('exits 2 when API key is missing', async () => {
    const output = captureOutput();
    const code = await workflowArchiveCommand({
      argv: [...BASE_ARGS, 'my-wf', '--version', '1'],
      env: {},
      output,
    });
    expect(code).toBe(2);
    expect(output.stderrLines.join('\n')).toMatch(/MEDIFORCE_API_KEY/);
  });

  it('archives specific version', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({ success: true, name: 'my-wf', version: 3, archived: true }),
    );
    const output = captureOutput();
    const code = await workflowArchiveCommand({
      argv: [...BASE_ARGS, 'my-wf', '--version', '3'],
      env: BASE_ENV,
      output,
    });
    expect(code).toBe(0);
    expect(output.stdoutLines.join('\n')).toContain('Archived my-wf v3');
    const url = fetchSpy.mock.calls[0]?.[0] as string;
    expect(url).toBe(
      'http://localhost:1234/api/workflow-definitions/my-wf/versions/3/archive',
    );
    const init = fetchSpy.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(init.body as string)).toEqual({ archived: true });
  });

  it('unarchives specific version with --unarchive', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({ success: true, name: 'my-wf', version: 3, archived: false }),
    );
    const output = captureOutput();
    const code = await workflowArchiveCommand({
      argv: [...BASE_ARGS, 'my-wf', '--version', '3', '--unarchive'],
      env: BASE_ENV,
      output,
    });
    expect(code).toBe(0);
    expect(output.stdoutLines.join('\n')).toContain('Unarchived my-wf v3');
  });

  it('archives all versions with --all', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({ success: true, name: 'my-wf', archived: true }),
    );
    const output = captureOutput();
    const code = await workflowArchiveCommand({
      argv: [...BASE_ARGS, 'my-wf', '--all'],
      env: BASE_ENV,
      output,
    });
    expect(code).toBe(0);
    expect(output.stdoutLines.join('\n')).toContain('Archived all versions of my-wf');
    const url = fetchSpy.mock.calls[0]?.[0] as string;
    expect(url).toBe(
      'http://localhost:1234/api/workflow-definitions/my-wf/archive',
    );
  });

  it('exits 1 with error on API 404', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({ error: 'Workflow not found' }, 404),
    );
    const output = captureOutput();
    const code = await workflowArchiveCommand({
      argv: [...BASE_ARGS, 'missing-wf', '--version', '1'],
      env: BASE_ENV,
      output,
    });
    expect(code).toBe(1);
    expect(output.stderrLines.join('\n')).toMatch(/not found/i);
  });

  it('--json mode outputs structured JSON', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({ success: true, name: 'my-wf', version: 2, archived: true }),
    );
    const output = captureOutput();
    const code = await workflowArchiveCommand({
      argv: [...BASE_ARGS, 'my-wf', '--version', '2', '--json'],
      env: BASE_ENV,
      output,
    });
    expect(code).toBe(0);
    const parsed = JSON.parse(output.stdoutLines.join('\n')) as Record<string, unknown>;
    expect(parsed).toMatchObject({
      success: true,
      name: 'my-wf',
      version: 2,
      archived: true,
    });
  });
});
