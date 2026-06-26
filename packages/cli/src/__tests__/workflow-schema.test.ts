import { describe, it, expect, vi, beforeEach } from 'vitest';
import { workflowSchemaCommand } from '../commands/workflow-schema';
import { captureOutput, jsonResponse } from './test-helpers';

beforeEach(() => {
  vi.restoreAllMocks();
});

const BASE_ENV = { MEDIFORCE_API_KEY: 'k' };
const BASE_ARGS = ['--base-url', 'http://localhost:1234'];

const SCHEMA = { type: 'object', properties: { steps: { type: 'array' } }, required: ['steps'] };

describe('workflow schema command', () => {
  it('prints help and exits 0 with --help', async () => {
    const output = captureOutput();
    const code = await workflowSchemaCommand({ argv: ['--help'], env: BASE_ENV, output });
    expect(code).toBe(0);
    expect(output.stdoutLines.join('\n')).toMatch(/USAGE mediforce workflow schema/);
  });

  it('fetches the live schema and prints it', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(jsonResponse({ schema: SCHEMA }));
    const output = captureOutput();
    const code = await workflowSchemaCommand({ argv: [...BASE_ARGS], env: BASE_ENV, output });
    expect(code).toBe(0);
    expect(fetchSpy.mock.calls[0]?.[0]).toBe(
      'http://localhost:1234/api/workflow-definitions/schema',
    );
    const parsed = JSON.parse(output.stdoutLines.join('\n')) as Record<string, unknown>;
    expect(parsed).toMatchObject({ type: 'object' });
    expect(parsed).toHaveProperty('properties');
  });

  it('exits 2 when API key is missing', async () => {
    const output = captureOutput();
    const code = await workflowSchemaCommand({ argv: [...BASE_ARGS], env: {}, output });
    expect(code).toBe(2);
    expect(output.stderrLines.join('\n')).toMatch(/MEDIFORCE_API_KEY/);
  });
});
