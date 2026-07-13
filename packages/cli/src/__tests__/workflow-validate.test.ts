import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import { writeFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { workflowValidateCommand } from '../commands/workflow-validate';
import { captureOutput, jsonResponse } from './test-helpers';

beforeEach(() => {
  vi.restoreAllMocks();
});

const BASE_ENV = { MEDIFORCE_API_KEY: 'k' };
const BASE_ARGS = ['--base-url', 'http://localhost:1234'];

const tmpFiles: string[] = [];
async function writeTmp(contents: string): Promise<string> {
  const path = join(tmpdir(), `workflow-validate-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
  await writeFile(path, contents, 'utf-8');
  tmpFiles.push(path);
  return path;
}
afterAll(async () => {
  await Promise.all(tmpFiles.map((p) => unlink(p).catch(() => {})));
});

describe('workflow validate command', () => {
  it('prints help and exits 0 with --help', async () => {
    const output = captureOutput();
    const code = await workflowValidateCommand({ argv: ['--help'], env: BASE_ENV, output });
    expect(code).toBe(0);
    expect(output.stdoutLines.join('\n')).toMatch(/USAGE mediforce workflow validate/);
  });

  it('exits 0 and POSTs to the validate endpoint when the definition is valid', async () => {
    const file = await writeTmp(JSON.stringify({ name: 'flow', steps: [] }));
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(jsonResponse({ valid: true, errors: [] }));
    const output = captureOutput();
    const code = await workflowValidateCommand({ argv: [...BASE_ARGS, file], env: BASE_ENV, output });
    expect(code).toBe(0);
    expect(fetchSpy.mock.calls[0]?.[0]).toBe('http://localhost:1234/api/workflow-definitions/validate');
    expect(output.stdoutLines.join('\n')).toMatch(/Valid/);
  });

  it('exits 1 and prints structured errors when invalid', async () => {
    const file = await writeTmp(JSON.stringify({ name: 'flow' }));
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({
        valid: false,
        errors: [{ path: 'steps', message: 'Required' }],
      }),
    );
    const output = captureOutput();
    const code = await workflowValidateCommand({ argv: [...BASE_ARGS, file], env: BASE_ENV, output });
    expect(code).toBe(1);
    expect(output.stderrLines.join('\n')).toMatch(/steps: Required/);
  });

  it('emits machine-readable output with --json', async () => {
    const file = await writeTmp(JSON.stringify({ name: 'flow' }));
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({ valid: false, errors: [{ path: 'steps', message: 'Required' }] }),
    );
    const output = captureOutput();
    const code = await workflowValidateCommand({ argv: [...BASE_ARGS, file, '--json'], env: BASE_ENV, output });
    expect(code).toBe(1);
    const parsed = JSON.parse(output.stdoutLines.join('\n')) as { valid: boolean };
    expect(parsed.valid).toBe(false);
  });

  it('exits 1 when the file cannot be read', async () => {
    const output = captureOutput();
    const code = await workflowValidateCommand({
      argv: [...BASE_ARGS, '/no/such/file.json'],
      env: BASE_ENV,
      output,
    });
    expect(code).toBe(1);
    expect(output.stderrLines.join('\n')).toMatch(/Failed to read file/);
  });

  it('exits 1 on invalid JSON', async () => {
    const file = await writeTmp('{ not json');
    const output = captureOutput();
    const code = await workflowValidateCommand({ argv: [...BASE_ARGS, file], env: BASE_ENV, output });
    expect(code).toBe(1);
    expect(output.stderrLines.join('\n')).toMatch(/Invalid JSON/);
  });

  it('exits 2 when API key is missing', async () => {
    const file = await writeTmp(JSON.stringify({ name: 'flow' }));
    const output = captureOutput();
    const code = await workflowValidateCommand({ argv: [...BASE_ARGS, file], env: {}, output });
    expect(code).toBe(2);
    expect(output.stderrLines.join('\n')).toMatch(/MEDIFORCE_API_KEY/);
  });
});
