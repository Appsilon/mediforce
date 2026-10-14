import { describe, it, expect, vi, beforeEach } from 'vitest';
import { workflowSetDefaultVersionCommand } from '../commands/workflow-set-default-version';
import { captureOutput, jsonResponse } from './test-helpers';

beforeEach(() => {
  vi.restoreAllMocks();
});

const BASE_ENV = { MEDIFORCE_API_KEY: 'k' };
const BASE_ARGS = ['--base-url', 'http://localhost:1234', '--namespace', 'ns1'];

describe('workflow set-default-version command', () => {
  it('exits 2 for an invalid --version', async () => {
    const output = captureOutput();
    const code = await workflowSetDefaultVersionCommand({
      argv: [...BASE_ARGS, 'my-wf', '--version', '0'],
      env: BASE_ENV,
      output,
    });
    expect(code).toBe(2);
    expect(output.stderrLines.join('\n')).toMatch(/Invalid --version/);
  });

  it('posts the version to the default-version endpoint', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({ success: true, name: 'my-wf', namespace: 'ns1', version: 4 }),
    );
    const output = captureOutput();
    const code = await workflowSetDefaultVersionCommand({
      argv: [...BASE_ARGS, 'my-wf', '--version', '4'],
      env: BASE_ENV,
      output,
    });
    expect(code).toBe(0);
    expect(output.stdoutLines.join('\n')).toContain('Set my-wf default version to v4');
    const url = fetchSpy.mock.calls[0]?.[0] as string;
    expect(url).toBe('http://localhost:1234/api/workflow-definitions/my-wf/default-version');
    const init = fetchSpy.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(init.body as string)).toEqual({ namespace: 'ns1', version: 4 });
  });

  it('exits 1 on API 404', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({ error: 'Version 9 not found for workflow \'my-wf\'' }, 404),
    );
    const output = captureOutput();
    const code = await workflowSetDefaultVersionCommand({
      argv: [...BASE_ARGS, 'my-wf', '--version', '9'],
      env: BASE_ENV,
      output,
    });
    expect(code).toBe(1);
    expect(output.stderrLines.join('\n')).toMatch(/not found/i);
  });
});
