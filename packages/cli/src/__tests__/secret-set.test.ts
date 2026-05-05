import { describe, it, expect, vi, beforeEach } from 'vitest';
import { secretSetCommand } from '../commands/secret-set.js';
import { captureOutput, jsonResponse } from './test-helpers.js';

beforeEach(() => {
  vi.restoreAllMocks();
});

const BASE_ENV = { MEDIFORCE_API_KEY: 'k' };
const BASE_ARGV = ['--workflow', 'wf-1', '--namespace', 'ns-1', '--key', 'TOKEN'];

describe('secret set command', () => {
  it('prints help on --help and exits 0', async () => {
    const output = captureOutput();
    const code = await secretSetCommand({
      argv: ['--help'],
      env: BASE_ENV,
      output,
    });
    expect(code).toBe(0);
    expect(output.stdoutLines.join('\n')).toMatch(/Usage: mediforce secret set/);
  });

  it('sets secret via --value flag', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({ ok: true }),
    );
    const output = captureOutput();
    const code = await secretSetCommand({
      argv: [...BASE_ARGV, '--value', 'secret-val', '--base-url', 'http://test:9000'],
      env: BASE_ENV,
      output,
    });
    expect(code).toBe(0);
    expect(output.stdoutLines.join('\n')).toMatch(/Secret "TOKEN" set/);
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toContain('/api/workflow-secrets');
    expect(url).toContain('namespace=ns-1');
    expect(url).toContain('workflow=wf-1');
    expect(init?.method).toBe('PUT');
    const body = JSON.parse(init?.body as string) as { key: string; value: string };
    expect(body).toEqual({ key: 'TOKEN', value: 'secret-val' });
  });

  it('sets secret via --stdin', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ ok: true }));
    const output = captureOutput();
    const code = await secretSetCommand({
      argv: [...BASE_ARGV, '--stdin'],
      env: BASE_ENV,
      output,
      stdin: async () => 'piped-value',
    });
    expect(code).toBe(0);
    const body = JSON.parse(
      (vi.mocked(globalThis.fetch).mock.calls[0]![1]?.body as string),
    ) as { value: string };
    expect(body.value).toBe('piped-value');
  });

  it('exits 2 when --value and --stdin both missing', async () => {
    const output = captureOutput();
    const code = await secretSetCommand({
      argv: BASE_ARGV,
      env: BASE_ENV,
      output,
    });
    expect(code).toBe(2);
    expect(output.stderrLines.join('\n')).toMatch(/--value or --stdin/);
  });

  it('exits 2 when --value and --stdin both present', async () => {
    const output = captureOutput();
    const code = await secretSetCommand({
      argv: [...BASE_ARGV, '--value', 'x', '--stdin'],
      env: BASE_ENV,
      output,
    });
    expect(code).toBe(2);
    expect(output.stderrLines.join('\n')).toMatch(/Cannot use both/);
  });

  it('exits 1 when stdin is empty', async () => {
    const output = captureOutput();
    const code = await secretSetCommand({
      argv: [...BASE_ARGV, '--stdin'],
      env: BASE_ENV,
      output,
      stdin: async () => '',
    });
    expect(code).toBe(1);
    expect(output.stderrLines.join('\n')).toMatch(/stdin was empty/);
  });

  it('exits 2 when required flags missing', async () => {
    const output = captureOutput();
    const code = await secretSetCommand({
      argv: ['--value', 'x'],
      env: BASE_ENV,
      output,
    });
    expect(code).toBe(2);
  });

  it('exits 1 on API error and prints status', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({ error: 'Forbidden' }, 403),
    );
    const output = captureOutput();
    const code = await secretSetCommand({
      argv: [...BASE_ARGV, '--value', 'x', '--json'],
      env: BASE_ENV,
      output,
    });
    expect(code).toBe(1);
    const parsed = JSON.parse(output.stdoutLines.join('\n')) as { status: number };
    expect(parsed.status).toBe(403);
  });

  it('exits 2 when API key missing', async () => {
    const output = captureOutput();
    const code = await secretSetCommand({
      argv: [...BASE_ARGV, '--value', 'x'],
      env: {},
      output,
    });
    expect(code).toBe(2);
  });

  it('emits JSON on success when --json set', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ ok: true }));
    const output = captureOutput();
    const code = await secretSetCommand({
      argv: [...BASE_ARGV, '--value', 'x', '--json'],
      env: BASE_ENV,
      output,
    });
    expect(code).toBe(0);
    expect(JSON.parse(output.stdoutLines.join('\n'))).toEqual({ ok: true });
  });
});
