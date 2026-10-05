import { describe, it, expect, vi, beforeEach } from 'vitest';
import { imagesCheckCommandCommand } from '../commands/images';
import { captureOutput, jsonResponse } from './test-helpers';

const BASE_ENV = { MEDIFORCE_API_KEY: 'k' };

beforeEach(() => {
  vi.restoreAllMocks();
});

async function run(extra: string[] = []) {
  const output = captureOutput();
  const code = await imagesCheckCommandCommand({
    argv: ['--namespace', 'alpha', '--command', 'uvx', '--base-url', 'http://test:9000', ...extra],
    env: BASE_ENV,
    output,
  });
  return { code, output };
}

describe('images check-command', () => {
  it('asks about the default agent image unless one is named', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(jsonResponse({ status: 'known', available: true, path: '/usr/local/bin/uvx' }));

    const { code, output } = await run();

    expect(code).toBe(0);
    expect(String(fetchSpy.mock.calls[0]?.[0])).toBe(
      'http://test:9000/api/image-catalog/command-check?namespace=alpha&image=mediforce-golden-image&command=uvx',
    );
    expect(output.stdoutLines.join('\n')).toContain('uvx is available in mediforce-golden-image (/usr/local/bin/uvx)');
  });

  it('says what a missing command means and exits non-zero', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ status: 'known', available: false }));

    const { code, output } = await run(['--image', 'alpine:3.24']);

    expect(code).toBe(1);
    expect(output.stdoutLines.join('\n')).toContain(
      'uvx is NOT available in alpine:3.24. An MCP server that runs it needs an image that provides it.',
    );
  });

  it('does not claim an answer it does not have', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ status: 'unknown' }));

    const { code, output } = await run();

    expect(code).toBe(2);
    expect(output.stdoutLines.join('\n')).toContain('Could not determine whether uvx is available');
  });

  it('emits the raw answer with --json', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ status: 'known', available: false }));

    const { output } = await run(['--json']);

    expect(JSON.parse(output.stdoutLines.join('\n'))).toEqual({ status: 'known', available: false });
  });
});
