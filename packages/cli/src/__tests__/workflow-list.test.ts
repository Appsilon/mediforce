import { describe, it, expect, vi, beforeEach } from 'vitest';
import { workflowListCommand } from '../commands/workflow-list.js';
import { buildWorkflowDefinition } from '@mediforce/platform-core/testing';
import { captureOutput, jsonResponse } from './test-helpers.js';

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('workflow list command', () => {
  it('exits 2 when no API key is set', async () => {
    const output = captureOutput();
    const code = await workflowListCommand({ argv: [], env: {}, output });
    expect(code).toBe(2);
    expect(output.stderrLines.join('\n')).toMatch(/MEDIFORCE_API_KEY/);
  });

  it('GETs /api/workflow-definitions and prints the list', async () => {
    const wd = buildWorkflowDefinition({ name: 'wf-a', version: 3 });
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({
        definitions: [
          { name: wd.name, latestVersion: 3, defaultVersion: 2, definition: wd },
        ],
      }),
    );
    const output = captureOutput();
    const code = await workflowListCommand({
      argv: ['--base-url', 'http://localhost:1234'],
      env: { MEDIFORCE_API_KEY: 'k' },
      output,
    });
    expect(code).toBe(0);
    expect(fetchSpy.mock.calls[0]?.[0]).toBe(
      'http://localhost:1234/api/workflow-definitions',
    );
    expect(output.stdoutLines.join('\n')).toMatch(/wf-a/);
    expect(output.stdoutLines.join('\n')).toMatch(/v3/);
  });

  it('reports an empty list with a helpful message', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({ definitions: [] }),
    );
    const output = captureOutput();
    const code = await workflowListCommand({
      argv: [],
      env: { MEDIFORCE_API_KEY: 'k' },
      output,
    });
    expect(code).toBe(0);
    expect(output.stdoutLines.join('\n')).toMatch(/No workflow definitions/);
  });

  it('emits structured JSON when --json is set', async () => {
    const wd = buildWorkflowDefinition({ name: 'wf-a', version: 1 });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({
        definitions: [
          { name: wd.name, latestVersion: 1, defaultVersion: 1, definition: wd },
        ],
      }),
    );
    const output = captureOutput();
    const code = await workflowListCommand({
      argv: ['--json'],
      env: { MEDIFORCE_API_KEY: 'k' },
      output,
    });
    expect(code).toBe(0);
    const parsed: unknown = JSON.parse(output.stdoutLines.join('\n'));
    expect(parsed).toMatchObject({
      definitions: [
        { name: 'wf-a', latestVersion: 1 },
      ],
    });
  });

  it('exits 1 with structured error on API failure', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({ error: 'forbidden' }, 403),
    );
    const output = captureOutput();
    const code = await workflowListCommand({
      argv: ['--json'],
      env: { MEDIFORCE_API_KEY: 'k' },
      output,
    });
    expect(code).toBe(1);
    const parsed: unknown = JSON.parse(output.stdoutLines.join('\n'));
    expect(parsed).toMatchObject({ status: 403 });
  });
});
