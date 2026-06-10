import { describe, it, expect, vi, beforeEach } from 'vitest';
import { taskCompleteCommand } from '../commands/task-complete';
import { captureOutput, jsonResponse } from './test-helpers';

beforeEach(() => {
  vi.restoreAllMocks();
});

const BASE_ENV = { MEDIFORCE_API_KEY: 'k' };

const COMPLETE_RESPONSE = {
  task: { id: 'task-1', status: 'completed' },
  run: { id: 'run-1', status: 'running' },
};

describe('task complete command', () => {
  it('prints help on --help', async () => {
    const output = captureOutput();
    const code = await taskCompleteCommand({ argv: ['--help'], env: BASE_ENV, output });
    expect(code).toBe(0);
    expect(output.stdoutLines.join('\n')).toMatch(/payload/i);
  });

  it('exits 2 when no payload provided', async () => {
    const output = captureOutput();
    const code = await taskCompleteCommand({
      argv: ['task-1', '--base-url', 'http://test:9000'],
      env: BASE_ENV,
      output,
    });
    expect(code).toBe(2);
    expect(output.stderrLines.join('\n')).toMatch(/--payload|--payload-file/);
  });

  it('exits 2 when both --payload and --payload-file given', async () => {
    const output = captureOutput();
    const code = await taskCompleteCommand({
      argv: ['task-1', '--payload', '{}', '--payload-file', 'f.json'],
      env: BASE_ENV,
      output,
    });
    expect(code).toBe(2);
    expect(output.stderrLines.join('\n')).toMatch(/mutually exclusive/);
  });

  it('exits 2 on invalid JSON payload', async () => {
    const output = captureOutput();
    const code = await taskCompleteCommand({
      argv: ['task-1', '--payload', '{bad'],
      env: BASE_ENV,
      output,
    });
    expect(code).toBe(2);
    expect(output.stderrLines.join('\n')).toMatch(/not valid JSON/);
  });

  it('completes task with inline --payload', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse(COMPLETE_RESPONSE),
    );
    const output = captureOutput();
    const code = await taskCompleteCommand({
      argv: ['task-1', '--payload', '{"verdict":"approve"}', '--base-url', 'http://test:9000'],
      env: BASE_ENV,
      output,
    });
    expect(code).toBe(0);
    expect(output.stdoutLines.join('\n')).toMatch(/task-1.*completed/i);
    const body = JSON.parse(fetchSpy.mock.calls[0]![1]?.body as string);
    expect(body.payload).toEqual({ verdict: 'approve' });
  });

  it('reads payload from stdin via --payload-file -', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse(COMPLETE_RESPONSE),
    );
    const output = captureOutput();
    const code = await taskCompleteCommand({
      argv: ['task-1', '--payload-file', '-', '--base-url', 'http://test:9000'],
      env: BASE_ENV,
      output,
      stdin: async () => '{"fromStdin":true}',
    });
    expect(code).toBe(0);
    const body = JSON.parse(fetchSpy.mock.calls[0]![1]?.body as string);
    expect(body.payload).toEqual({ fromStdin: true });
  });

  it('outputs JSON on --json', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse(COMPLETE_RESPONSE),
    );
    const output = captureOutput();
    const code = await taskCompleteCommand({
      argv: ['task-1', '--payload', '{}', '--json', '--base-url', 'http://test:9000'],
      env: BASE_ENV,
      output,
    });
    expect(code).toBe(0);
    const parsed = JSON.parse(output.stdoutLines[0]!);
    expect(parsed.task.id).toBe('task-1');
    expect(parsed.task.status).toBe('completed');
  });
});
