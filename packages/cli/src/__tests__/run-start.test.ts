import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runStartCommand } from '../commands/run-start.js';
import { captureOutput, jsonResponse } from './test-helpers.js';

beforeEach(() => {
  vi.restoreAllMocks();
});

const BASE_ENV = { MEDIFORCE_API_KEY: 'k' };

describe('run start command', () => {
  it('prints help on --help and exits 0', async () => {
    const output = captureOutput();
    const code = await runStartCommand({ argv: ['--help'], env: BASE_ENV, output });
    expect(code).toBe(0);
    expect(output.stdoutLines.join('\n')).toMatch(/--workflow/);
    expect(output.stdoutLines.join('\n')).toMatch(/--input/);
    expect(output.stdoutLines.join('\n')).toMatch(/--input-file/);
  });

  it('exits 2 when --workflow missing', async () => {
    const output = captureOutput();
    const code = await runStartCommand({ argv: [], env: BASE_ENV, output });
    expect(code).toBe(2);
    expect(output.stderrLines.join('\n')).toMatch(/--workflow is required/);
  });

  it('starts a run without payload', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({ instanceId: 'inst-1', status: 'running' }),
    );
    const output = captureOutput();
    const code = await runStartCommand({
      argv: ['--workflow', 'my-wf', '--base-url', 'http://test:9000'],
      env: BASE_ENV,
      output,
    });
    expect(code).toBe(0);
    expect(output.stdoutLines.join('\n')).toMatch(/inst-1/);
    const body = JSON.parse(fetchSpy.mock.calls[0]![1]?.body as string);
    expect(body.payload).toBeUndefined();
  });

  it('passes inline --input JSON as payload', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({ instanceId: 'inst-2', status: 'running' }),
    );
    const output = captureOutput();
    const code = await runStartCommand({
      argv: [
        '--workflow', 'my-wf',
        '--input', '{"ruleId":"CORE-000127"}',
        '--base-url', 'http://test:9000',
      ],
      env: BASE_ENV,
      output,
    });
    expect(code).toBe(0);
    const body = JSON.parse(fetchSpy.mock.calls[0]![1]?.body as string);
    expect(body.payload).toEqual({ ruleId: 'CORE-000127' });
  });

  it('exits 2 on invalid --input JSON', async () => {
    const output = captureOutput();
    const code = await runStartCommand({
      argv: ['--workflow', 'my-wf', '--input', '{bad json'],
      env: BASE_ENV,
      output,
    });
    expect(code).toBe(2);
    expect(output.stderrLines.join('\n')).toMatch(/not valid JSON/);
  });

  it('exits 2 when --input is not an object', async () => {
    const output = captureOutput();
    const code = await runStartCommand({
      argv: ['--workflow', 'my-wf', '--input', '"string"'],
      env: BASE_ENV,
      output,
    });
    expect(code).toBe(2);
    expect(output.stderrLines.join('\n')).toMatch(/must be a JSON object/);
  });

  it('exits 2 when --input is an array', async () => {
    const output = captureOutput();
    const code = await runStartCommand({
      argv: ['--workflow', 'my-wf', '--input', '[1,2]'],
      env: BASE_ENV,
      output,
    });
    expect(code).toBe(2);
    expect(output.stderrLines.join('\n')).toMatch(/must be a JSON object/);
  });

  it('exits 2 when both --input and --input-file given', async () => {
    const output = captureOutput();
    const code = await runStartCommand({
      argv: ['--workflow', 'my-wf', '--input', '{}', '--input-file', 'f.json'],
      env: BASE_ENV,
      output,
    });
    expect(code).toBe(2);
    expect(output.stderrLines.join('\n')).toMatch(/Cannot use both/);
  });

  it('reads payload from stdin via --input-file -', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({ instanceId: 'inst-3', status: 'running' }),
    );
    const output = captureOutput();
    const code = await runStartCommand({
      argv: ['--workflow', 'my-wf', '--input-file', '-', '--base-url', 'http://test:9000'],
      env: BASE_ENV,
      output,
      stdin: async () => '{"fromStdin":true}',
    });
    expect(code).toBe(0);
    const body = JSON.parse(fetchSpy.mock.calls[0]![1]?.body as string);
    expect(body.payload).toEqual({ fromStdin: true });
  });

  it('exits 2 on invalid JSON from --input-file stdin', async () => {
    const output = captureOutput();
    const code = await runStartCommand({
      argv: ['--workflow', 'my-wf', '--input-file', '-'],
      env: BASE_ENV,
      output,
      stdin: async () => 'not json',
    });
    expect(code).toBe(2);
    expect(output.stderrLines.join('\n')).toMatch(/invalid JSON/);
  });

  it('reports API errors', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({ error: 'Invalid payload', details: [{ field: 'ruleId', message: 'required' }] }, 400),
    );
    const output = captureOutput();
    const code = await runStartCommand({
      argv: ['--workflow', 'my-wf', '--input', '{}', '--base-url', 'http://test:9000'],
      env: BASE_ENV,
      output,
    });
    expect(code).toBe(1);
  });

  it('outputs JSON on --json flag', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({ instanceId: 'inst-4', status: 'running' }),
    );
    const output = captureOutput();
    const code = await runStartCommand({
      argv: ['--workflow', 'my-wf', '--json', '--base-url', 'http://test:9000'],
      env: BASE_ENV,
      output,
    });
    expect(code).toBe(0);
    const parsed = JSON.parse(output.stdoutLines[0]!);
    expect(parsed.instanceId).toBe('inst-4');
  });
});
