import { describe, it, expect, vi, beforeEach } from 'vitest';
import { systemCreditsCommand } from '../commands/system-credits';
import { captureOutput, jsonResponse } from './test-helpers';

const CREDITS_RESPONSE = {
  available: true,
  limit: 30,
  usage: 19.85,
  remaining: 10.15,
};

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('system credits', () => {
  it('shows balance in human mode', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(CREDITS_RESPONSE));
    const output = captureOutput();
    const code = await systemCreditsCommand({
      argv: ['--namespace', 'my-org'],
      env: { MEDIFORCE_API_KEY: 'k' },
      output,
    });
    expect(code).toBe(0);
    const text = output.stdoutLines.join('\n');
    expect(text).toContain('$10.15');
    expect(text).toContain('$19.85');
    expect(text).toContain('$30.00');
  });

  it('emits JSON when --json', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(CREDITS_RESPONSE));
    const output = captureOutput();
    const code = await systemCreditsCommand({
      argv: ['--namespace', 'my-org', '--json'],
      env: { MEDIFORCE_API_KEY: 'k' },
      output,
    });
    expect(code).toBe(0);
    const parsed = JSON.parse(output.stdoutLines.join('\n'));
    expect(parsed.available).toBe(true);
    expect(parsed.remaining).toBe(10.15);
  });

  it('returns exit 1 when unavailable', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({ available: false, limit: 0, usage: 0, remaining: 0, error: 'Not configured' }),
    );
    const output = captureOutput();
    const code = await systemCreditsCommand({
      argv: ['--namespace', 'my-org'],
      env: { MEDIFORCE_API_KEY: 'k' },
      output,
    });
    expect(code).toBe(1);
    expect(output.stderrLines.join('\n')).toContain('Not configured');
  });

  it('requires --namespace', async () => {
    const output = captureOutput();
    const code = await systemCreditsCommand({
      argv: [],
      env: { MEDIFORCE_API_KEY: 'k' },
      output,
    });
    expect(code).toBe(2);
  });

  it('shows help', async () => {
    const output = captureOutput();
    const code = await systemCreditsCommand({
      argv: ['--help'],
      env: { MEDIFORCE_API_KEY: 'k' },
      output,
    });
    expect(code).toBe(0);
    expect(output.stdoutLines.join('\n')).toContain('USAGE');
  });
});
