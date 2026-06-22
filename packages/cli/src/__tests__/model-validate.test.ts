import { describe, it, expect, vi, beforeEach } from 'vitest';
import { modelValidateCommand } from '../commands/model-validate';
import { captureOutput, jsonResponse } from './test-helpers';

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('model validate command', () => {
  it('prints help on --help and exits 0', async () => {
    const output = captureOutput();
    const code = await modelValidateCommand({
      argv: ['--help'],
      env: { MEDIFORCE_API_KEY: 'k' },
      output,
    });
    expect(code).toBe(0);
    expect(output.stdoutLines.join('\n')).toMatch(/USAGE mediforce model validate/);
  });

  it('exits 2 when no model IDs positional is given', async () => {
    const output = captureOutput();
    const code = await modelValidateCommand({
      argv: [],
      env: { MEDIFORCE_API_KEY: 'k' },
      output,
    });
    expect(code).toBe(2);
    expect(output.stderrLines.join('\n') + output.stdoutLines.join('\n')).toMatch(
      /Missing required positional argument: MODELIDS/,
    );
  });

  it('prints success when all models are valid', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({ unknown: [] }),
    );
    const output = captureOutput();
    const code = await modelValidateCommand({
      argv: ['anthropic/claude-sonnet-4,openai/gpt-4o', '--base-url', 'http://localhost:5555'],
      env: { MEDIFORCE_API_KEY: 'k' },
      output,
    });
    expect(code).toBe(0);
    const text = output.stdoutLines.join('\n');
    expect(text).toBe('All models found in registry.');
  });

  it('POSTs to /api/model-registry/validate with correct body', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({ unknown: [] }),
    );
    const output = captureOutput();
    await modelValidateCommand({
      argv: ['anthropic/claude-sonnet-4,openai/gpt-4o', '--base-url', 'http://localhost:5555'],
      env: { MEDIFORCE_API_KEY: 'k' },
      output,
    });
    expect(fetchSpy.mock.calls[0]?.[0]).toBe(
      'http://localhost:5555/api/model-registry/validate',
    );
    const requestInit = fetchSpy.mock.calls[0]?.[1] as RequestInit;
    expect(requestInit.method).toBe('POST');
    const body: unknown = JSON.parse(requestInit.body as string);
    expect(body).toEqual({ modelIds: ['anthropic/claude-sonnet-4', 'openai/gpt-4o'] });
  });

  it('prints unknown models with suggestions and exits 1', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({
        unknown: [
          { id: 'anthropic/claude-sonet-4', suggestion: 'anthropic/claude-sonnet-4' },
          { id: 'nonexistent/model', suggestion: null },
        ],
      }),
    );
    const output = captureOutput();
    const code = await modelValidateCommand({
      argv: ['anthropic/claude-sonet-4,nonexistent/model'],
      env: { MEDIFORCE_API_KEY: 'k' },
      output,
    });
    expect(code).toBe(1);
    const text = output.stdoutLines.join('\n');
    expect(text).toMatch(/2 unknown model/);
    expect(text).toMatch(/anthropic\/claude-sonet-4\s+\(did you mean: anthropic\/claude-sonnet-4\)/);
    expect(text).toMatch(/nonexistent\/model/);
    expect(text).not.toMatch(/nonexistent\/model.*did you mean/);
  });

  it('emits structured JSON and exits 0 when all valid', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({ unknown: [] }),
    );
    const output = captureOutput();
    const code = await modelValidateCommand({
      argv: ['anthropic/claude-sonnet-4', '--json'],
      env: { MEDIFORCE_API_KEY: 'k' },
      output,
    });
    expect(code).toBe(0);
    const parsed: unknown = JSON.parse(output.stdoutLines.join('\n'));
    expect(parsed).toEqual({ unknown: [] });
  });

  it('emits structured JSON and exits 1 when unknown models exist', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({
        unknown: [{ id: 'bad/model', suggestion: 'good/model' }],
      }),
    );
    const output = captureOutput();
    const code = await modelValidateCommand({
      argv: ['bad/model', '--json'],
      env: { MEDIFORCE_API_KEY: 'k' },
      output,
    });
    expect(code).toBe(1);
    const parsed: unknown = JSON.parse(output.stdoutLines.join('\n'));
    expect(parsed).toEqual({
      unknown: [{ id: 'bad/model', suggestion: 'good/model' }],
    });
  });

  it('exits 2 when API key is missing', async () => {
    const output = captureOutput();
    const code = await modelValidateCommand({
      argv: ['anthropic/claude-sonnet-4'],
      env: {},
      output,
    });
    expect(code).toBe(2);
  });
});
