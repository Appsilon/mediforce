import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import { readFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { workflowGetCommand } from '../commands/workflow-get.js';
import { buildWorkflowDefinition } from '@mediforce/platform-core/testing';
import { captureOutput, jsonResponse } from './test-helpers.js';

beforeEach(() => {
  vi.restoreAllMocks();
});

const BASE_ENV = { MEDIFORCE_API_KEY: 'k' };
const BASE_ARGS = ['--base-url', 'http://localhost:1234'];

function makeDefinition(overrides?: Parameters<typeof buildWorkflowDefinition>[0]) {
  return buildWorkflowDefinition({
    createdAt: '2026-01-01T00:00:00Z',
    ...overrides,
  });
}

describe('workflow get command', () => {
  it('prints help and exits 0 with --help', async () => {
    const output = captureOutput();
    const code = await workflowGetCommand({
      argv: ['--help'],
      env: BASE_ENV,
      output,
    });
    expect(code).toBe(0);
    expect(output.stdoutLines.join('\n')).toMatch(/Usage: mediforce workflow get/);
  });

  it('exits 2 when <name> is missing', async () => {
    const output = captureOutput();
    const code = await workflowGetCommand({
      argv: [...BASE_ARGS],
      env: BASE_ENV,
      output,
    });
    expect(code).toBe(2);
    expect(output.stderrLines.join('\n')).toMatch(/<name> is required/);
  });

  it('exits 2 for invalid --version (non-integer)', async () => {
    const output = captureOutput();
    const code = await workflowGetCommand({
      argv: [...BASE_ARGS, 'my-wf', '--version', 'abc'],
      env: BASE_ENV,
      output,
    });
    expect(code).toBe(2);
    expect(output.stderrLines.join('\n')).toMatch(/Invalid --version/);
  });

  it('exits 2 for invalid --version (zero)', async () => {
    const output = captureOutput();
    const code = await workflowGetCommand({
      argv: [...BASE_ARGS, 'my-wf', '--version', '0'],
      env: BASE_ENV,
      output,
    });
    expect(code).toBe(2);
    expect(output.stderrLines.join('\n')).toMatch(/Invalid --version/);
  });

  it('exits 2 for invalid --version (negative)', async () => {
    const output = captureOutput();
    const code = await workflowGetCommand({
      argv: [...BASE_ARGS, 'my-wf', '--version', '-1'],
      env: BASE_ENV,
      output,
    });
    expect(code).toBe(2);
    // parseArgs treats -1 as ambiguous flag — still exits 2 with error on stderr
    expect(output.stderrLines.length).toBeGreaterThan(0);
  });

  it('fetches and prints JSON to stdout on success', async () => {
    const wd = makeDefinition({ name: 'my-wf', version: 2 });
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({ definition: wd }),
    );
    const output = captureOutput();
    const code = await workflowGetCommand({
      argv: [...BASE_ARGS, 'my-wf', '--json'],
      env: BASE_ENV,
      output,
    });
    expect(code).toBe(0);
    expect(fetchSpy.mock.calls[0]?.[0]).toBe(
      'http://localhost:1234/api/workflow-definitions/my-wf',
    );
    const parsed: unknown = JSON.parse(output.stdoutLines.join('\n'));
    expect(parsed).toMatchObject({ name: 'my-wf', version: 2 });
  });

  it('--json flag produces full JSON output', async () => {
    const wd = makeDefinition({ name: 'wf-json', version: 5 });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({ definition: wd }),
    );
    const output = captureOutput();
    const code = await workflowGetCommand({
      argv: [...BASE_ARGS, 'wf-json', '--json'],
      env: BASE_ENV,
      output,
    });
    expect(code).toBe(0);
    const parsed: unknown = JSON.parse(output.stdoutLines.join('\n'));
    expect(parsed).toMatchObject({
      name: 'wf-json',
      version: 5,
      namespace: 'test',
    });
  });

  it('human-readable mode (no --json) prints summary line', async () => {
    const wd = makeDefinition({ name: 'mediforce-fullstack', version: 3, namespace: 'appsilon' });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({ definition: wd }),
    );
    const output = captureOutput();
    const code = await workflowGetCommand({
      argv: [...BASE_ARGS, 'mediforce-fullstack'],
      env: BASE_ENV,
      output,
    });
    expect(code).toBe(0);
    const line = output.stdoutLines.join('\n');
    expect(line).toContain('mediforce-fullstack');
    expect(line).toContain('v3');
    expect(line).toContain('namespace: appsilon');
    expect(line).toContain('3 steps');
    expect(line).toContain('2 transitions');
    expect(line).toContain('1 triggers');
  });

  it('--template strips version, createdAt, namespace from output', async () => {
    const wd = makeDefinition({ name: 'tpl-wf', version: 4, namespace: 'ns1' });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({ definition: wd }),
    );
    const output = captureOutput();
    const code = await workflowGetCommand({
      argv: [...BASE_ARGS, 'tpl-wf', '--template', '--json'],
      env: BASE_ENV,
      output,
    });
    expect(code).toBe(0);
    const parsed = JSON.parse(output.stdoutLines.join('\n')) as Record<string, unknown>;
    expect(parsed).toHaveProperty('name', 'tpl-wf');
    expect(parsed).not.toHaveProperty('version');
    expect(parsed).not.toHaveProperty('createdAt');
    expect(parsed).not.toHaveProperty('namespace');
  });

  const tmpFile = join(tmpdir(), `workflow-get-test-${Date.now()}.json`);
  afterAll(async () => {
    await unlink(tmpFile).catch(() => {});
  });

  it('--output writes to file', async () => {
    const wd = makeDefinition({ name: 'file-wf', version: 1 });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({ definition: wd }),
    );
    const output = captureOutput();
    const code = await workflowGetCommand({
      argv: [...BASE_ARGS, 'file-wf', '--output', tmpFile],
      env: BASE_ENV,
      output,
    });
    expect(code).toBe(0);
    expect(output.stdoutLines.join('\n')).toContain(`Written to ${tmpFile}`);
    const contents = await readFile(tmpFile, 'utf-8');
    const parsed = JSON.parse(contents) as Record<string, unknown>;
    expect(parsed).toMatchObject({ name: 'file-wf' });
  });

  it('exits 1 with error on API 404', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({ error: 'Workflow not found' }, 404),
    );
    const output = captureOutput();
    const code = await workflowGetCommand({
      argv: [...BASE_ARGS, 'missing-wf'],
      env: BASE_ENV,
      output,
    });
    expect(code).toBe(1);
    expect(output.stderrLines.join('\n')).toMatch(/404/);
  });

  it('exits 2 when API key is missing', async () => {
    const output = captureOutput();
    const code = await workflowGetCommand({
      argv: [...BASE_ARGS, 'my-wf'],
      env: {},
      output,
    });
    expect(code).toBe(2);
    expect(output.stderrLines.join('\n')).toMatch(/MEDIFORCE_API_KEY/);
  });
});
