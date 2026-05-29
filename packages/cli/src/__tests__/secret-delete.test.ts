import { describe, it, expect, vi, beforeEach } from 'vitest';
import { secretDeleteCommand } from '../commands/secret-delete';
import { captureOutput, jsonResponse } from './test-helpers';

beforeEach(() => {
  vi.restoreAllMocks();
});

const BASE_ENV = { MEDIFORCE_API_KEY: 'k' };
const BASE_ARGV = ['--workflow', 'wf-1', '--namespace', 'ns-1', '--key', 'OLD_KEY'];

describe('secret delete command', () => {
  it('prints help on --help and exits 0', async () => {
    const output = captureOutput();
    const code = await secretDeleteCommand({
      argv: ['--help'],
      env: BASE_ENV,
      output,
    });
    expect(code).toBe(0);
    expect(output.stdoutLines.join('\n')).toMatch(/USAGE mediforce secret delete/);
  });

  it('deletes secret and prints confirmation', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({ ok: true }),
    );
    const output = captureOutput();
    const code = await secretDeleteCommand({
      argv: [...BASE_ARGV, '--base-url', 'http://test:9000'],
      env: BASE_ENV,
      output,
    });
    expect(code).toBe(0);
    expect(output.stdoutLines.join('\n')).toMatch(/Secret "OLD_KEY" deleted/);
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toContain('namespace=ns-1');
    expect(url).toContain('workflow=wf-1');
    expect(url).toContain('key=OLD_KEY');
    expect(init?.method).toBe('DELETE');
  });

  it('emits JSON on success when --json set', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ ok: true }));
    const output = captureOutput();
    const code = await secretDeleteCommand({
      argv: [...BASE_ARGV, '--json'],
      env: BASE_ENV,
      output,
    });
    expect(code).toBe(0);
    expect(JSON.parse(output.stdoutLines.join('\n'))).toEqual({ ok: true });
  });

  it('exits 2 when required flags missing', async () => {
    const output = captureOutput();
    const code = await secretDeleteCommand({
      argv: ['--workflow', 'wf-1', '--namespace', 'ns-1'],
      env: BASE_ENV,
      output,
    });
    expect(code).toBe(2);
    expect(output.stderrLines.join('\n')).toMatch(/Missing required argument: --key/);
  });

  it('exits 1 on API error', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({ error: 'Not found' }, 404),
    );
    const output = captureOutput();
    const code = await secretDeleteCommand({
      argv: [...BASE_ARGV, '--json'],
      env: BASE_ENV,
      output,
    });
    expect(code).toBe(1);
    const parsed = JSON.parse(output.stdoutLines.join('\n')) as { status: number };
    expect(parsed.status).toBe(404);
  });

  it('deletes namespace-level secret when --workflow omitted', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({ ok: true }),
    );
    const output = captureOutput();
    const code = await secretDeleteCommand({
      argv: ['--namespace', 'ns-1', '--key', 'OLD_KEY'],
      env: BASE_ENV,
      output,
    });
    expect(code).toBe(0);
    const url = fetchSpy.mock.calls[0]![0] as string;
    expect(url).toContain('namespace=ns-1');
    expect(url).not.toContain('workflow=');
    expect(output.stdoutLines.join('\n')).toMatch(/namespace "ns-1"/);
  });

  it('exits 2 when API key missing', async () => {
    const output = captureOutput();
    const code = await secretDeleteCommand({
      argv: BASE_ARGV,
      env: {},
      output,
    });
    expect(code).toBe(2);
  });
});
