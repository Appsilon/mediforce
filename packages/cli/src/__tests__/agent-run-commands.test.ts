import { describe, it, expect, vi, beforeEach } from 'vitest';
import { agentRunListCommand } from '../commands/agent-run-list';
import { agentRunGetCommand } from '../commands/agent-run-get';
import { agentRunTrajectoryCommand } from '../commands/agent-run-trajectory';
import { captureOutput, jsonResponse } from './test-helpers';

const SAMPLE_RUN = {
  id: 'ar-1',
  processInstanceId: 'inst-a',
  stepId: 'step-review',
  pluginId: '@mediforce/example-agent',
  autonomyLevel: 'L2',
  status: 'completed',
  envelope: null,
  fallbackReason: null,
  startedAt: '2026-05-28T10:00:00.000Z',
  completedAt: '2026-05-28T10:01:00.000Z',
};

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('agent-run list command', () => {
  it('GETs /api/agent-runs and prints rows', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({ runs: [SAMPLE_RUN] }),
    );
    const output = captureOutput();
    const code = await agentRunListCommand({
      argv: ['--namespace', 'team-alpha', '--base-url', 'http://localhost:5555'],
      env: { MEDIFORCE_API_KEY: 'k' },
      output,
    });
    expect(code).toBe(0);
    const url = fetchSpy.mock.calls[0]?.[0] as string;
    expect(url).toMatch(/http:\/\/localhost:5555\/api\/agent-runs/);
    expect(url).toMatch(/namespace=team-alpha/);
    expect(output.stdoutLines.join('\n')).toMatch(/ar-1/);
  });

  it('passes --run-id and --step-id as query params', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({ runs: [] }),
    );
    await agentRunListCommand({
      argv: ['--run-id', 'inst-a', '--step-id', 'review'],
      env: { MEDIFORCE_API_KEY: 'k' },
      output: captureOutput(),
    });
    const url = fetchSpy.mock.calls[0]?.[0] as string;
    expect(url).toMatch(/runId=inst-a/);
    expect(url).toMatch(/stepId=review/);
  });

  it('exits 2 when --step-id is given without --run-id', async () => {
    const output = captureOutput();
    const code = await agentRunListCommand({
      argv: ['--step-id', 'review'],
      env: { MEDIFORCE_API_KEY: 'k' },
      output,
    });
    expect(code).toBe(2);
    expect(output.stderrLines.join('\n')).toMatch(/--step-id requires --run-id/);
  });

  it('renders the nextCursor hint when present', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({ runs: [SAMPLE_RUN], nextCursor: 'token-x' }),
    );
    const output = captureOutput();
    await agentRunListCommand({
      argv: [],
      env: { MEDIFORCE_API_KEY: 'k' },
      output,
    });
    expect(output.stdoutLines.join('\n')).toMatch(/--cursor token-x/);
  });
});

describe('agent-run get command', () => {
  it('GETs /api/agent-runs/:id and prints the entity', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({ run: SAMPLE_RUN }),
    );
    const output = captureOutput();
    const code = await agentRunGetCommand({
      argv: ['ar-1'],
      env: { MEDIFORCE_API_KEY: 'k' },
      output,
    });
    expect(code).toBe(0);
    expect(fetchSpy.mock.calls[0]?.[0]).toMatch(/\/api\/agent-runs\/ar-1/);
    expect(output.stdoutLines.join('\n')).toMatch(/Agent run ar-1/);
  });
});

describe('agent-run trajectory command', () => {
  const AGENT_RUN_ID = '6f1c1b1e-0c5b-4a3e-9a51-2f6a8f0e4d21';

  it('GETs the trajectory and prints one line per entry', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({
        agentRunId: AGENT_RUN_ID,
        entries: [
          { seq: 0, ts: '2026-09-23T08:00:00.000Z', type: 'assistant', subtype: 'tool_call', tool: 'Read', input: { file_path: '/data/ae.csv' } },
          { seq: 1, ts: '2026-09-23T08:00:01.000Z', type: 'result', subtype: 'success' },
        ],
      }),
    );
    const output = captureOutput();
    const code = await agentRunTrajectoryCommand({
      argv: [AGENT_RUN_ID, '--base-url', 'http://localhost:5555'],
      env: { MEDIFORCE_API_KEY: 'k' },
      output,
    });
    expect(code).toBe(0);
    expect(fetchSpy.mock.calls[0]?.[0]).toBe(`http://localhost:5555/api/agent-runs/${AGENT_RUN_ID}/trajectory`);
    const printed = output.stdoutLines.join('\n');
    expect(printed).toMatch(/0 {2}2026-09-23T08:00:00.000Z {2}assistant\/tool_call {2}Read {2}\{"file_path":"\/data\/ae.csv"\}/);
    expect(printed).toMatch(/result\/success/);
  });
});
