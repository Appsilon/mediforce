import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  workflowTriggerAddCommand,
  workflowTriggerListCommand,
  workflowTriggerUpdateCommand,
} from '../commands/workflow-trigger';
import { captureOutput, jsonResponse } from './test-helpers';

/**
 * `--payload` from argv to the wire (ADR-0012). The client used to drop
 * `payload` while still answering 200, so a test that stops at the client call
 * proves nothing — every case here asserts the request body that actually left
 * the process, or that no request left at all.
 */

const ARGS = ['--namespace', 'team-alpha', '--base-url', 'http://x'];
const ENV = { MEDIFORCE_API_KEY: 'k' };

function cronRow(payload?: Record<string, unknown>) {
  return {
    namespace: 'team-alpha',
    workflowName: 'flow',
    name: 'nightly',
    type: 'cron',
    enabled: true,
    config: { schedule: '0 3 * * *', ...(payload === undefined ? {} : { payload }) },
    lastTriggeredAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

function sentBody(call: [unknown, RequestInit | undefined]): Record<string, unknown> {
  return JSON.parse(String(call[1]?.body)) as Record<string, unknown>;
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('workflow trigger-add --payload', () => {
  it('sends the parsed object as `payload` and echoes it back', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(jsonResponse({ trigger: cronRow({ region: 'eu' }), webhookUrl: null }));
    const output = captureOutput();

    const code = await workflowTriggerAddCommand({
      argv: [
        'flow',
        '--trigger', 'nightly',
        '--type', 'cron',
        '--schedule', '0 3 * * *',
        '--payload', '{"region":"eu"}',
        ...ARGS,
      ],
      env: ENV,
      output,
    });

    expect(code).toBe(0);
    const call = fetchSpy.mock.calls[0]!;
    expect(call[0]).toBe('http://x/api/workflow-definitions/flow/triggers');
    expect(call[1]?.method).toBe('POST');
    expect(sentBody(call)).toMatchObject({
      namespace: 'team-alpha',
      triggerName: 'nightly',
      type: 'cron',
      schedule: '0 3 * * *',
      payload: { region: 'eu' },
    });
    expect(output.stdoutLines.join('\n')).toContain('0 3 * * *  {"region":"eu"}');
  });

  it('omits `payload` entirely when the flag is not passed', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(jsonResponse({ trigger: cronRow(), webhookUrl: null }));

    const code = await workflowTriggerAddCommand({
      argv: ['flow', '--trigger', 'nightly', '--schedule', '0 3 * * *', ...ARGS],
      env: ENV,
      output: captureOutput(),
    });

    expect(code).toBe(0);
    expect('payload' in sentBody(fetchSpy.mock.calls[0]!)).toBe(false);
  });

  it('exits 1 without calling the API when --payload is not valid JSON', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const output = captureOutput();

    const code = await workflowTriggerAddCommand({
      argv: ['flow', '--trigger', 'nightly', '--schedule', '0 3 * * *', '--payload', '{region:eu}', ...ARGS],
      env: ENV,
      output,
    });

    expect(code).toBe(1);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(output.stderrLines.join('\n')).toMatch(/--payload is not valid JSON/);
  });

  it('exits 1 without calling the API when --payload is JSON but not an object', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const output = captureOutput();

    const code = await workflowTriggerAddCommand({
      argv: ['flow', '--trigger', 'nightly', '--schedule', '0 3 * * *', '--payload', '["eu"]', ...ARGS],
      env: ENV,
      output,
    });

    expect(code).toBe(1);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(output.stderrLines.join('\n')).toMatch(/must be a JSON object/);
  });
});

describe('workflow trigger-update --payload', () => {
  it('PATCHes the payload alone, leaving the schedule out of the body', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(jsonResponse({ trigger: cronRow({ region: 'us' }) }));

    const code = await workflowTriggerUpdateCommand({
      argv: ['flow', '--trigger', 'nightly', '--payload', '{"region":"us"}', ...ARGS],
      env: ENV,
      output: captureOutput(),
    });

    expect(code).toBe(0);
    const call = fetchSpy.mock.calls[0]!;
    expect(call[0]).toBe('http://x/api/workflow-definitions/flow/triggers/nightly');
    expect(call[1]?.method).toBe('PATCH');
    const body = sentBody(call);
    expect(body.payload).toEqual({ region: 'us' });
    expect('schedule' in body).toBe(false);
  });

  it("sends an empty object for --payload '{}' — the documented way to clear it", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(jsonResponse({ trigger: cronRow() }));

    const code = await workflowTriggerUpdateCommand({
      argv: ['flow', '--trigger', 'nightly', '--payload', '{}', ...ARGS],
      env: ENV,
      output: captureOutput(),
    });

    expect(code).toBe(0);
    expect(sentBody(fetchSpy.mock.calls[0]!).payload).toEqual({});
  });

  it('exits 1 without calling the API when neither --schedule nor --payload is passed', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const output = captureOutput();

    const code = await workflowTriggerUpdateCommand({
      argv: ['flow', '--trigger', 'nightly', ...ARGS],
      env: ENV,
      output,
    });

    expect(code).toBe(1);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(output.stderrLines.join('\n')).toMatch(/Pass --schedule, --payload, or both/);
  });
});

describe('workflow trigger-list', () => {
  it('renders the static payload beside the schedule so two cron rows are distinguishable', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({
        triggers: [
          { ...cronRow({ region: 'eu' }), name: 'nightly-eu' },
          { ...cronRow({ region: 'us' }), name: 'nightly-us' },
        ],
      }),
    );
    const output = captureOutput();

    const code = await workflowTriggerListCommand({
      argv: ['flow', ...ARGS],
      env: ENV,
      output,
    });

    expect(code).toBe(0);
    expect(output.stdoutLines).toEqual([
      'enabled   cron  nightly-eu  0 3 * * *  {"region":"eu"}',
      'enabled   cron  nightly-us  0 3 * * *  {"region":"us"}',
    ]);
  });
});
