import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { workflowRegisterCommand } from '../commands/workflow-register.js';
import { buildWorkflowDefinition } from '@mediforce/platform-core/testing';
import { captureOutput, jsonResponse } from './test-helpers.js';

let tempDir: string;
let wdFile: string;

beforeEach(async () => {
  vi.restoreAllMocks();
  tempDir = await mkdtemp(path.join(tmpdir(), 'mediforce-cli-test-'));
  wdFile = path.join(tempDir, 'workflow.json');
  const wd = buildWorkflowDefinition({ name: 'sample-wf' });
  const { version: _v, namespace: _n, createdAt: _c, ...body } = wd;
  void _v;
  void _n;
  void _c;
  await writeFile(wdFile, JSON.stringify(body), 'utf-8');
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe('workflow register command', () => {
  it('exits 2 with a useful error when --file is missing', async () => {
    const output = captureOutput();
    const code = await workflowRegisterCommand({
      argv: ['--namespace', 'Appsilon'],
      env: { MEDIFORCE_API_KEY: 'k' },
      output,
    });
    expect(code).toBe(2);
    expect(output.stderrLines.join('\n')).toMatch(/--file is required/);
  });

  it('exits 2 with a useful error when --namespace is missing', async () => {
    const output = captureOutput();
    const code = await workflowRegisterCommand({
      argv: ['--file', wdFile],
      env: { MEDIFORCE_API_KEY: 'k' },
      output,
    });
    expect(code).toBe(2);
    expect(output.stderrLines.join('\n')).toMatch(/--namespace is required/);
  });

  it('exits 1 when the file is missing', async () => {
    const output = captureOutput();
    const code = await workflowRegisterCommand({
      argv: ['--file', '/nope/does-not-exist.json', '--namespace', 'Appsilon'],
      env: { MEDIFORCE_API_KEY: 'k' },
      output,
    });
    expect(code).toBe(1);
    expect(output.stderrLines.join('\n')).toMatch(/Failed to read file/);
  });

  it('exits 1 when the file is invalid JSON', async () => {
    const bad = path.join(tempDir, 'bad.json');
    await writeFile(bad, '{ not json', 'utf-8');
    const output = captureOutput();
    const code = await workflowRegisterCommand({
      argv: ['--file', bad, '--namespace', 'Appsilon'],
      env: { MEDIFORCE_API_KEY: 'k' },
      output,
    });
    expect(code).toBe(1);
    expect(output.stderrLines.join('\n')).toMatch(/Invalid JSON/);
  });

  it('--dry-run validates locally without calling the API', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const output = captureOutput();
    const code = await workflowRegisterCommand({
      argv: ['--file', wdFile, '--namespace', 'Appsilon', '--dry-run'],
      env: { MEDIFORCE_API_KEY: 'k' },
      output,
    });
    expect(code).toBe(0);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(output.stdoutLines.join('\n')).toMatch(/dry-run/i);
  });

  it('--dry-run rejects inputForNextRun referencing an unknown stepId (server parity)', async () => {
    // Without superRefine, `RegisterWorkflowInputSchema` accepts this body
    // and dry-run would pass while a real POST would 400. Mirroring
    // `parseWorkflowDefinitionForCreation` server-side keeps the two in
    // lockstep — see workflow-register.ts dry-run path.
    const wd = buildWorkflowDefinition({ name: 'sample-wf' });
    const { version: _v, namespace: _n, createdAt: _c, ...body } = wd;
    void _v;
    void _n;
    void _c;
    const malformed = {
      ...body,
      inputForNextRun: [{ stepId: 'does-not-exist', output: 'x', as: 'y' }],
    };
    const malformedFile = path.join(tempDir, 'malformed.json');
    await writeFile(malformedFile, JSON.stringify(malformed), 'utf-8');

    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const output = captureOutput();
    const code = await workflowRegisterCommand({
      argv: ['--file', malformedFile, '--namespace', 'Appsilon', '--dry-run', '--json'],
      env: { MEDIFORCE_API_KEY: 'k' },
      output,
    });
    expect(code).toBe(1);
    expect(fetchSpy).not.toHaveBeenCalled();
    const parsed: unknown = JSON.parse(output.stdoutLines.join('\n'));
    expect(parsed).toMatchObject({ error: 'Validation failed' });
    // Same issue shape the server emits — Zod issue array with a path
    // pointing at the offending entry.
    const issues = (parsed as { body: Array<{ path: Array<string | number> }> }).body;
    expect(Array.isArray(issues)).toBe(true);
    expect(
      issues.some(
        (issue) =>
          Array.isArray(issue.path) &&
          issue.path[0] === 'inputForNextRun' &&
          issue.path[2] === 'stepId',
      ),
    ).toBe(true);
  });

  it('POSTs to /api/workflow-definitions with namespace + apiKey', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(jsonResponse({ success: true, name: 'sample-wf', version: 1 }, 201));
    const output = captureOutput();
    const code = await workflowRegisterCommand({
      argv: [
        '--file',
        wdFile,
        '--namespace',
        'Appsilon',
        '--base-url',
        'http://localhost:9999',
      ],
      env: { MEDIFORCE_API_KEY: 'secret' },
      output,
    });
    expect(code).toBe(0);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe('http://localhost:9999/api/workflow-definitions?namespace=Appsilon');
    expect(init?.method).toBe('POST');
    expect(new Headers(init?.headers).get('X-Api-Key')).toBe('secret');
    expect(output.stdoutLines.join('\n')).toMatch(/Registered sample-wf v1/);
  });

  it('emits structured JSON when --json is set', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({ success: true, name: 'sample-wf', version: 7 }, 201),
    );
    const output = captureOutput();
    const code = await workflowRegisterCommand({
      argv: ['--file', wdFile, '--namespace', 'Appsilon', '--json'],
      env: { MEDIFORCE_API_KEY: 'k' },
      output,
    });
    expect(code).toBe(0);
    const parsed: unknown = JSON.parse(output.stdoutLines.join('\n'));
    expect(parsed).toMatchObject({ success: true, name: 'sample-wf', version: 7 });
  });

  it('exits 1 with API-error JSON shape on non-2xx', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({ error: 'Validation failed' }, 400),
    );
    const output = captureOutput();
    const code = await workflowRegisterCommand({
      argv: ['--file', wdFile, '--namespace', 'Appsilon', '--json'],
      env: { MEDIFORCE_API_KEY: 'k' },
      output,
    });
    expect(code).toBe(1);
    const parsed: unknown = JSON.parse(output.stdoutLines.join('\n'));
    expect(parsed).toMatchObject({ error: 'Validation failed', status: 400 });
  });
});
