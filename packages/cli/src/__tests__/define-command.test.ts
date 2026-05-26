import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ApiError } from '@mediforce/platform-api/client';
import { defineCommand, type EagerContext } from '../define-command.js';
import { captureOutput, jsonResponse } from './test-helpers.js';

beforeEach(() => {
  vi.restoreAllMocks();
});

const HELP = `Usage: mediforce widget poke <id> [options]

Poke a widget.

Flags:
  --json    Emit JSON
  --help    Show help
`;

const OPTIONS = {
  'base-url': { type: 'string' },
  json: { type: 'boolean' },
  help: { type: 'boolean', short: 'h' },
} as const;

function makeCommand(
  handler: (ctx: EagerContext<typeof OPTIONS>) => Promise<number>,
) {
  return defineCommand({
    name: 'widget poke',
    help: HELP,
    options: OPTIONS,
    positionals: ['<id>'] as const,
    handler,
  });
}

describe('defineCommand helper', () => {
  it('exits 2 when no positionals are given', async () => {
    const cmd = makeCommand(async () => 0);
    const output = captureOutput();
    const code = await cmd({ argv: [], env: { MEDIFORCE_API_KEY: 'k' }, output });
    expect(code).toBe(2);
    expect(output.stderrLines.join('\n')).toMatch(/<id> is required/);
    expect(output.stderrLines.join('\n')).toMatch(/Usage: mediforce widget poke/);
  });

  it('exits 2 when too many positionals are given', async () => {
    const cmd = makeCommand(async () => 0);
    const output = captureOutput();
    const code = await cmd({
      argv: ['one', 'two'],
      env: { MEDIFORCE_API_KEY: 'k' },
      output,
    });
    expect(code).toBe(2);
    expect(output.stderrLines.join('\n')).toMatch(/Expected exactly one <id>, got 2/);
    expect(output.stderrLines.join('\n')).toMatch(/Usage: mediforce widget poke/);
  });

  it('exits 2 on parseArgs failure (unknown flag)', async () => {
    const cmd = makeCommand(async () => 0);
    const output = captureOutput();
    const code = await cmd({
      argv: ['--no-such-flag'],
      env: { MEDIFORCE_API_KEY: 'k' },
      output,
    });
    expect(code).toBe(2);
    expect(output.stderrLines.join('\n')).toMatch(/mediforce widget poke:/);
    expect(output.stderrLines.join('\n')).toMatch(/Usage: mediforce widget poke/);
  });

  it('exits 2 when resolveConfig throws (missing API key)', async () => {
    const cmd = makeCommand(async () => 0);
    const output = captureOutput();
    const code = await cmd({ argv: ['widget-1'], env: {}, output });
    expect(code).toBe(2);
    expect(output.stderrLines.join('\n')).toMatch(/missing API key/);
  });

  it('exits 0 with HELP on stdout when --help is passed', async () => {
    const cmd = makeCommand(async () => 0);
    const output = captureOutput();
    const code = await cmd({
      argv: ['--help'],
      env: { MEDIFORCE_API_KEY: 'k' },
      output,
    });
    expect(code).toBe(0);
    expect(output.stdoutLines.join('\n')).toMatch(/Usage: mediforce widget poke/);
    expect(output.stderrLines).toEqual([]);
  });

  it('exits 1 and formats ApiError through formatCliError', async () => {
    const cmd = makeCommand(async ({ mediforce, positionals }) => {
      // Use the constructed mediforce to make a request; mocked fetch returns 404.
      await mediforce.runs.get({ runId: positionals[0]! });
      return 0;
    });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({ error: 'Not found' }, 404),
    );
    const output = captureOutput();
    const code = await cmd({
      argv: ['missing', '--json'],
      env: { MEDIFORCE_API_KEY: 'k' },
      output,
    });
    expect(code).toBe(1);
    const parsed: unknown = JSON.parse(output.stdoutLines.join('\n'));
    expect(parsed).toMatchObject({ status: 404 });
  });

  it('catches a raw ApiError thrown from the handler', async () => {
    const cmd = makeCommand(async () => {
      throw new ApiError(500, 'Boom', { detail: 'kaboom' });
    });
    const output = captureOutput();
    const code = await cmd({
      argv: ['widget-1', '--json'],
      env: { MEDIFORCE_API_KEY: 'k' },
      output,
    });
    expect(code).toBe(1);
    const parsed: unknown = JSON.parse(output.stdoutLines.join('\n'));
    expect(parsed).toMatchObject({ status: 500, error: 'Boom' });
  });

  it('exposes jsonMode = true to handler when --json is set', async () => {
    let observed: boolean | undefined;
    const cmd = makeCommand(async ({ jsonMode, output }) => {
      observed = jsonMode;
      output.stdout(JSON.stringify({ ok: true }));
      return 0;
    });
    const output = captureOutput();
    const code = await cmd({
      argv: ['widget-1', '--json'],
      env: { MEDIFORCE_API_KEY: 'k' },
      output,
    });
    expect(code).toBe(0);
    expect(observed).toBe(true);
  });

  it('exposes jsonMode = false by default', async () => {
    let observed: boolean | undefined;
    const cmd = makeCommand(async ({ jsonMode }) => {
      observed = jsonMode;
      return 0;
    });
    const output = captureOutput();
    const code = await cmd({
      argv: ['widget-1'],
      env: { MEDIFORCE_API_KEY: 'k' },
      output,
    });
    expect(code).toBe(0);
    expect(observed).toBe(false);
  });

  it('routes --base-url into the Mediforce client', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({ runId: 'w', status: 'completed', currentStepId: null, error: null, finalOutput: null }),
    );
    const cmd = makeCommand(async ({ mediforce, positionals }) => {
      await mediforce.runs.get({ runId: positionals[0]! });
      return 0;
    });
    const output = captureOutput();
    const code = await cmd({
      argv: ['w', '--base-url', 'http://example.test:1234'],
      env: { MEDIFORCE_API_KEY: 'k' },
      output,
    });
    expect(code).toBe(0);
    expect(fetchSpy.mock.calls[0]?.[0]).toBe('http://example.test:1234/api/runs/w');
  });

  it('does not require an API key when skipClientWhen returns true', async () => {
    const cmd = defineCommand({
      name: 'widget dry',
      help: HELP,
      options: { 'dry-run': { type: 'boolean' }, ...OPTIONS } as const,
      positionals: [] as const,
      skipClientWhen: (flags) => flags['dry-run'] === true,
      handler: async ({ mediforce, config }) => {
        // Both null on the dry-run path.
        if (mediforce !== null || config !== null) return 99;
        return 0;
      },
    });
    const output = captureOutput();
    const code = await cmd({ argv: ['--dry-run'], env: {}, output });
    expect(code).toBe(0);
  });

  it('still constructs client when skipClientWhen returns false', async () => {
    let mediforceSeen: unknown;
    const cmd = defineCommand({
      name: 'widget dry',
      help: HELP,
      options: { 'dry-run': { type: 'boolean' }, ...OPTIONS } as const,
      positionals: [] as const,
      skipClientWhen: (flags) => flags['dry-run'] === true,
      handler: async ({ mediforce }) => {
        mediforceSeen = mediforce;
        return 0;
      },
    });
    const output = captureOutput();
    const code = await cmd({ argv: [], env: { MEDIFORCE_API_KEY: 'k' }, output });
    expect(code).toBe(0);
    expect(mediforceSeen).not.toBeNull();
  });
});
