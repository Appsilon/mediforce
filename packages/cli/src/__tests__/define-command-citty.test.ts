import { describe, it, expect, vi, beforeEach } from 'vitest';
import { defineCommand } from '../define-command';
import { captureOutput, jsonResponse } from './test-helpers';

beforeEach(() => {
  vi.restoreAllMocks();
});

const trivial = defineCommand({
  name: 'mediforce widget poke',
  description: 'Poke a widget by id.',
  args: {
    widgetId: {
      type: 'positional',
      required: true,
      description: 'Widget id',
    },
  },
  async run({ args, mediforce, output, jsonMode }) {
    // Drive a fake API call so we can assert the client was constructed.
    const data = await mediforce.runs.get({ runId: args.widgetId });
    if (jsonMode === true) output.stdout(JSON.stringify(data));
    else output.stdout(`got ${String(data.runId)}`);
    return 0;
  },
});

describe('citty defineCommand wrapper', () => {
  it('exits 2 and emits a `<positional> is required` error when missing', async () => {
    const output = captureOutput();
    const code = await trivial({
      argv: [],
      env: { MEDIFORCE_API_KEY: 'k' },
      output,
    });
    expect(code).toBe(2);
    const all = output.stderrLines.join('\n') + output.stdoutLines.join('\n');
    expect(all).toMatch(/Missing required positional argument: WIDGETID/);
    expect(all).toMatch(/USAGE mediforce widget poke/);
  });

  it('exits 2 when API key is missing from env', async () => {
    const output = captureOutput();
    const code = await trivial({
      argv: ['w-1'],
      env: {},
      output,
    });
    expect(code).toBe(2);
    expect(output.stderrLines.join('\n')).toMatch(/missing API key/);
  });

  it('exits 1 and emits a structured envelope when the API errors', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ error: 'Widget not found' }, 404));
    const output = captureOutput();
    const code = await trivial({
      argv: ['w-1', '--json'],
      env: { MEDIFORCE_API_KEY: 'k' },
      output,
    });
    expect(code).toBe(1);
    const parsed: unknown = JSON.parse(output.stdoutLines.join('\n'));
    expect(parsed).toMatchObject({ status: 404 });
  });

  it('exits 2 when given extra positional arguments', async () => {
    const output = captureOutput();
    const code = await trivial({
      argv: ['w-1', 'extra-1', 'extra-2'],
      env: { MEDIFORCE_API_KEY: 'k' },
      output,
    });
    expect(code).toBe(2);
    const all = output.stderrLines.join('\n') + output.stdoutLines.join('\n');
    expect(all).toMatch(/Unexpected positional arguments: extra-1 extra-2/);
  });

  it('prints help and exits 0 on --help', async () => {
    const output = captureOutput();
    const code = await trivial({
      argv: ['--help'],
      env: {},
      output,
    });
    expect(code).toBe(0);
    expect(output.stdoutLines.join('\n')).toMatch(/USAGE mediforce widget poke/);
    // No error envelope when asking for help.
    expect(output.stderrLines.join('\n')).toBe('');
  });
});
