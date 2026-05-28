import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runStartCommand } from '../commands/run-start.js';
import { captureOutput, jsonResponse } from './test-helpers.js';

beforeEach(() => {
  vi.restoreAllMocks();
});

const BASE_ENV = { MEDIFORCE_API_KEY: 'k' };

// Minimal ProcessInstance shape — entity-echo response per ADR-0005 §5.
function mkRun(id: string, status = 'running'): { run: Record<string, unknown> } {
  return {
    run: {
      id,
      definitionName: 'my-wf',
      definitionVersion: '1',
      status,
      currentStepId: null,
      variables: {},
      triggerType: 'manual',
      triggerPayload: {},
      createdAt: '2026-05-26T00:00:00.000Z',
      updatedAt: '2026-05-26T00:00:00.000Z',
      createdBy: 'test',
      pauseReason: null,
      error: null,
      assignedRoles: [],
      deleted: false,
      archived: false,
      namespace: 'test',
    },
  };
}

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
    expect(output.stderrLines.join('\n')).toMatch(/Missing required argument: --workflow/);
  });

  it('starts a run without payload', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse(mkRun('inst-1')),
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

  it('passes --namespace to the start run request body', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse(mkRun('inst-ns')),
    );
    const output = captureOutput();
    const code = await runStartCommand({
      argv: ['--workflow', 'my-wf', '--namespace', 'test', '--base-url', 'http://test:9000'],
      env: BASE_ENV,
      output,
    });

    expect(code).toBe(0);
    const body = JSON.parse(fetchSpy.mock.calls[0]![1]?.body as string);
    expect(body.namespace).toBe('test');
  });

  it('passes inline --input JSON as payload', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse(mkRun('inst-2')),
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
    expect(output.stderrLines.join('\n')).toMatch(/mutually exclusive/);
  });

  it('reads payload from stdin via --input-file -', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse(mkRun('inst-3')),
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
      jsonResponse(mkRun('inst-4')),
    );
    const output = captureOutput();
    const code = await runStartCommand({
      argv: ['--workflow', 'my-wf', '--json', '--base-url', 'http://test:9000'],
      env: BASE_ENV,
      output,
    });
    expect(code).toBe(0);
    const parsed = JSON.parse(output.stdoutLines[0]!);
    expect(parsed.run.id).toBe('inst-4');
  });
});
