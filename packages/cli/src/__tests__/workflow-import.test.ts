import { describe, it, expect, vi, beforeEach } from 'vitest';
import { workflowImportCommand } from '../commands/workflow-import.js';
import { buildWorkflowDefinition } from '@mediforce/platform-core/testing';
import { captureOutput, jsonResponse } from './test-helpers.js';

const REPO_URL = 'https://github.com/Appsilon/mediforce-workflows';
const RAW_BASE = 'https://raw.githubusercontent.com/Appsilon/mediforce-workflows/main';

function makeManifest(overrides?: object) {
  return {
    workflows: [
      {
        name: 'Workflow Designer',
        path: 'workflow-designer/workflow-designer.wd.json',
        description: 'Design workflows',
        builtin: true,
        ...overrides,
      },
    ],
  };
}

function makeTemplate() {
  const wd = buildWorkflowDefinition({ name: 'workflow-designer' });
  const { version: _v, namespace: _n, createdAt: _c, ...body } = wd;
  return body;
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('workflow import command', () => {
  it('exits 2 when --repo is missing', async () => {
    const output = captureOutput();
    const code = await workflowImportCommand({
      argv: ['--namespace', 'my-ns'],
      env: { MEDIFORCE_API_KEY: 'k' },
      output,
    });
    expect(code).toBe(2);
    expect(output.stderrLines.join('\n')).toMatch(/Missing required argument: --repo/);
  });

  it('exits 2 when --namespace is missing', async () => {
    const output = captureOutput();
    const code = await workflowImportCommand({
      argv: ['--repo', REPO_URL],
      env: { MEDIFORCE_API_KEY: 'k' },
      output,
    });
    expect(code).toBe(2);
    expect(output.stderrLines.join('\n')).toMatch(/Missing required argument: --namespace/);
  });

  it('exits 1 for non-GitHub URLs', async () => {
    const output = captureOutput();
    const code = await workflowImportCommand({
      argv: ['--repo', 'https://gitlab.com/org/repo', '--namespace', 'my-ns'],
      env: { MEDIFORCE_API_KEY: 'k' },
      output,
    });
    expect(code).toBe(1);
    expect(output.stderrLines.join('\n')).toMatch(/Only GitHub URLs are supported/);
  });

  it('exits 1 when manifest fetch fails', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('Not Found', { status: 404 }));
    const output = captureOutput();
    const code = await workflowImportCommand({
      argv: ['--repo', REPO_URL, '--namespace', 'my-ns'],
      env: { MEDIFORCE_API_KEY: 'k' },
      output,
    });
    expect(code).toBe(1);
    expect(output.stderrLines.join('\n')).toMatch(/Failed to fetch manifest/);
  });

  it('lists available workflows when --workflow is omitted', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(makeManifest()));
    const output = captureOutput();
    const code = await workflowImportCommand({
      argv: ['--repo', REPO_URL, '--namespace', 'my-ns'],
      env: { MEDIFORCE_API_KEY: 'k' },
      output,
    });
    expect(code).toBe(0);
    expect(output.stdoutLines.join('\n')).toMatch(/Workflow Designer/);
    expect(output.stdoutLines.join('\n')).toMatch(/--workflow/);
  });

  it('lists in JSON when --workflow is omitted and --json is set', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(makeManifest()));
    const output = captureOutput();
    const code = await workflowImportCommand({
      argv: ['--repo', REPO_URL, '--namespace', 'my-ns', '--json'],
      env: { MEDIFORCE_API_KEY: 'k' },
      output,
    });
    expect(code).toBe(0);
    const parsed = JSON.parse(output.stdoutLines.join('\n')) as { workflows: unknown[] };
    expect(parsed.workflows).toHaveLength(1);
  });

  it('exits 1 when --workflow not found in manifest', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(makeManifest()));
    const output = captureOutput();
    const code = await workflowImportCommand({
      argv: ['--repo', REPO_URL, '--namespace', 'my-ns', '--workflow', 'Does Not Exist'],
      env: { MEDIFORCE_API_KEY: 'k' },
      output,
    });
    expect(code).toBe(1);
    expect(output.stderrLines.join('\n')).toMatch(/not found in manifest/);
  });

  it('fetches manifest then workflow file, registers with source metadata', async () => {
    const template = makeTemplate();
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse(makeManifest()))
      .mockResolvedValueOnce(jsonResponse(template))
      .mockResolvedValueOnce(jsonResponse({ success: true, name: 'workflow-designer', version: 1 }, 201));

    const output = captureOutput();
    const code = await workflowImportCommand({
      argv: [
        '--repo', REPO_URL,
        '--namespace', 'my-ns',
        '--workflow', 'Workflow Designer',
        '--base-url', 'http://localhost:9999',
      ],
      env: { MEDIFORCE_API_KEY: 'secret' },
      output,
    });

    expect(code).toBe(0);
    const calls = vi.mocked(globalThis.fetch).mock.calls;
    expect(calls[0]![0]).toBe(`${RAW_BASE}/index.json`);
    expect(calls[1]![0]).toBe(`${RAW_BASE}/workflow-designer/workflow-designer.wd.json`);

    const registerCall = calls[2]!;
    expect(registerCall[0]).toBe('http://localhost:9999/api/workflow-definitions?namespace=my-ns');
    const body = JSON.parse(registerCall[1]!.body as string) as { source: { repo: string; path: string; ref: string } };
    expect(body.source).toEqual({
      repo: REPO_URL,
      path: 'workflow-designer/workflow-designer.wd.json',
      ref: 'main',
    });

    expect(output.stdoutLines.join('\n')).toMatch(/Imported workflow-designer v1 into my-ns/);
  });

  it('uses --ref when provided', async () => {
    const template = makeTemplate();
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse(makeManifest()))
      .mockResolvedValueOnce(jsonResponse(template))
      .mockResolvedValueOnce(jsonResponse({ success: true, name: 'workflow-designer', version: 1 }, 201));

    await workflowImportCommand({
      argv: [
        '--repo', REPO_URL,
        '--namespace', 'my-ns',
        '--workflow', 'Workflow Designer',
        '--ref', 'v2.0.0',
      ],
      env: { MEDIFORCE_API_KEY: 'k' },
      output: captureOutput(),
    });

    const manifestUrl = vi.mocked(globalThis.fetch).mock.calls[0]![0] as string;
    expect(manifestUrl).toContain('/v2.0.0/');
  });
});
