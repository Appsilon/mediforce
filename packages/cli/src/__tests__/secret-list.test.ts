import { describe, it, expect, vi, beforeEach } from 'vitest';
import { secretListCommand } from '../commands/secret-list.js';
import { captureOutput, jsonResponse } from './test-helpers.js';

beforeEach(() => {
  vi.restoreAllMocks();
});

const BASE_ENV = { MEDIFORCE_API_KEY: 'k' };
const BASE_ARGV = ['--workflow', 'wf-1', '--namespace', 'ns-1'];

describe('secret list command', () => {
  it('prints help on --help and exits 0', async () => {
    const output = captureOutput();
    const code = await secretListCommand({
      argv: ['--help'],
      env: BASE_ENV,
      output,
    });
    expect(code).toBe(0);
    expect(output.stdoutLines.join('\n')).toMatch(/Usage: mediforce secret list/);
  });

  it('lists secret keys in human-readable format', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({ keys: ['API_TOKEN', 'DB_PASSWORD'] }),
    );
    const output = captureOutput();
    const code = await secretListCommand({
      argv: [...BASE_ARGV, '--base-url', 'http://test:9000'],
      env: BASE_ENV,
      output,
    });
    expect(code).toBe(0);
    const text = output.stdoutLines.join('\n');
    expect(text).toMatch(/API_TOKEN/);
    expect(text).toMatch(/DB_PASSWORD/);
    expect(text).toMatch(/2/);
  });

  it('emits JSON when --json set', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({ keys: ['KEY_A'] }),
    );
    const output = captureOutput();
    const code = await secretListCommand({
      argv: [...BASE_ARGV, '--json'],
      env: BASE_ENV,
      output,
    });
    expect(code).toBe(0);
    expect(JSON.parse(output.stdoutLines.join('\n'))).toEqual({ keys: ['KEY_A'] });
  });

  it('prints empty message when no secrets', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ keys: [] }));
    const output = captureOutput();
    const code = await secretListCommand({
      argv: BASE_ARGV,
      env: BASE_ENV,
      output,
    });
    expect(code).toBe(0);
    expect(output.stdoutLines.join('\n')).toMatch(/No secrets configured/);
  });

  it('exits 2 when required flags missing', async () => {
    const output = captureOutput();
    const code = await secretListCommand({
      argv: ['--workflow', 'wf-1'],
      env: BASE_ENV,
      output,
    });
    expect(code).toBe(2);
  });

  it('exits 1 on API error', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({ error: 'Unauthorized' }, 401),
    );
    const output = captureOutput();
    const code = await secretListCommand({
      argv: [...BASE_ARGV, '--json'],
      env: BASE_ENV,
      output,
    });
    expect(code).toBe(1);
    const parsed = JSON.parse(output.stdoutLines.join('\n')) as { status: number };
    expect(parsed.status).toBe(401);
  });

  it('verifies fetch URL contains correct query params', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({ keys: [] }),
    );
    const output = captureOutput();
    await secretListCommand({
      argv: [...BASE_ARGV, '--base-url', 'http://test:9000'],
      env: BASE_ENV,
      output,
    });
    const url = fetchSpy.mock.calls[0]![0] as string;
    expect(url).toContain('namespace=ns-1');
    expect(url).toContain('workflow=wf-1');
  });
});
