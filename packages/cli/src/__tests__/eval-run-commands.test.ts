import { describe, it, expect, vi, beforeEach } from 'vitest';
import { evalRunPrepareCommand, evalRunStartCommand } from '../commands/eval-runs';
import { captureOutput, jsonResponse } from './test-helpers';

const ENV = { MEDIFORCE_API_KEY: 'k' };
const BASE = ['--base-url', 'http://localhost:5555'];
const RUN_ID = '0e2a3c4d-5b6f-4a1e-9c8d-7b6a5f4e3d2c';

const OUTPUT = {
  evalRun: {
    namespace: 'pharma-a', workflowName: 'ae-grading', stepId: 'grade-aes', id: RUN_ID, definitionVersion: 2,
    datasetVersionId: '1e2a3c4d-5b6f-4a1e-9c8d-7b6a5f4e3d2c', caseIds: ['2e2a3c4d-5b6f-4a1e-9c8d-7b6a5f4e3d2c'],
    trialsPerCase: 3, concurrency: 2,
    evaluators: [{ evaluatorId: '3e2a3c4d-5b6f-4a1e-9c8d-7b6a5f4e3d2c', name: 'findings-present', version: 1, kind: 'schema', severity: 'critical', counted: true }],
    mcpPolicy: {}, estimate: { perTrialUsd: 0.2, totalUsd: 0.6, basis: 'history', sampleSize: 5 },
    budgetUsd: 0.9, spentUsd: 0, status: 'prepared', createdBy: 'u-1', createdAt: '2026-09-23T08:00:00.000Z',
    startedAt: null, completedAt: null,
  },
  trials: [],
  report: {
    k: 3, trials: { total: 3, scored: 0, failed: 0, skipped: 0, inProgress: 3 },
    evaluators: [{
      evaluatorId: '3e2a3c4d-5b6f-4a1e-9c8d-7b6a5f4e3d2c', name: 'findings-present', version: 1, kind: 'schema', severity: 'critical', counted: true,
      passes: 0, failures: 0, errors: 0, passRate: null, wilsonLower: null, wilsonUpper: null, passAtK: null, passHatK: null, flakiness: null,
    }],
    costUsd: 0, meanCostUsd: null, inputTokens: 0, outputTokens: 0, meanDurationMs: null, maxDurationMs: null,
  },
};

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('mediforce eval runs', () => {
  it('run-prepare posts the step and trial count, and prints how to start with the budget', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(OUTPUT, 201));
    const output = captureOutput();
    const code = await evalRunPrepareCommand({
      argv: ['--namespace', 'pharma-a', '--workflow', 'ae-grading', '--step', 'grade-aes', '--trials', '3', ...BASE],
      env: ENV,
      output,
    });

    expect(code).toBe(0);
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe('http://localhost:5555/api/evaluation/runs');
    expect(JSON.parse(String(init?.body))).toMatchObject({ namespace: 'pharma-a', workflowName: 'ae-grading', stepId: 'grade-aes', trialsPerCase: 3 });
    expect(output.stdoutLines.join('\n')).toContain(`mediforce eval run-start ${RUN_ID} --confirm-budget 0.9`);
  });

  it('run-start sends the confirmed budget', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ ...OUTPUT, evalRun: { ...OUTPUT.evalRun, status: 'running' } }));
    const output = captureOutput();
    const code = await evalRunStartCommand({ argv: [RUN_ID, '--confirm-budget', '0.9', ...BASE], env: ENV, output });

    expect(code).toBe(0);
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe(`http://localhost:5555/api/evaluation/runs/${RUN_ID}/start`);
    expect(JSON.parse(String(init?.body))).toEqual({ confirmedBudgetUsd: 0.9 });
  });
});

describe('mediforce eval ask', () => {
  it('sends the question for the step and prints proposals without applying them', async () => {
    const { evalAskCommand } = await import('../commands/eval-ask');
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({
      reply: 'Start with a schema check.',
      proposals: [{ tool: 'propose_brief', arguments: { text: 'Grades AEs for the DSMB.' } }],
      preparedEvalRuns: [],
    }));
    const output = captureOutput();
    const code = await evalAskCommand({
      argv: ['What should I check?', '--namespace', 'pharma-a', '--workflow', 'ae-grading', '--step', 'grade-aes', ...BASE],
      env: ENV,
      output,
    });

    expect(code).toBe(0);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe('http://localhost:5555/api/evaluation/assistant');
    expect(JSON.parse(String(init?.body))).toMatchObject({ stepId: 'grade-aes', messages: [{ role: 'user', content: 'What should I check?' }] });
    expect(output.stdoutLines.join('\n')).toContain('proposal propose_brief');
  });
});
