import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { evalCompareGetCommand, evalComparePrepareCommand, evalCompareStartCommand } from '../commands/eval-compare';
import { captureOutput, jsonResponse } from './test-helpers';

const ENV = { MEDIFORCE_API_KEY: 'k' };
const BASE = ['--base-url', 'http://localhost:5555'];
const STEP_ARGV = ['--namespace', 'pharma-a', '--workflow', 'ae-grading', '--step', 'grade-aes'];
const COMPARISON_ID = '5e2a3c4d-5b6f-4a1e-9c8d-7b6a5f4e3d2c';
const BASELINE_ID = '0e2a3c4d-5b6f-4a1e-9c8d-7b6a5f4e3d2c';
const VARIANT_ID = '6e2a3c4d-5b6f-4a1e-9c8d-7b6a5f4e3d2c';
const EVALUATOR_ID = '3e2a3c4d-5b6f-4a1e-9c8d-7b6a5f4e3d2c';
const DATASET_ID = '1e2a3c4d-5b6f-4a1e-9c8d-7b6a5f4e3d2c';

function evalRun(id: string, variant: { model?: string; prompt?: string } | null) {
  return {
    namespace: 'pharma-a', workflowName: 'ae-grading', stepId: 'grade-aes', agentId: null, id, definitionVersion: 2, agentVersion: null,
    datasetVersionId: DATASET_ID, caseIds: ['2e2a3c4d-5b6f-4a1e-9c8d-7b6a5f4e3d2c'], trialsPerCase: 3, concurrency: 2,
    evaluators: [{ evaluatorId: EVALUATOR_ID, name: 'findings-present', version: 1, kind: 'schema', counted: true }],
    variant, variantAgentHash: null, comparisonId: COMPARISON_ID, fingerprint: null, acceptanceCriteria: { minPassRate: 0.9 },
    mcpPolicy: {}, env: {}, estimate: { perTrialUsd: 0.2, totalUsd: 0.6, basis: 'history', sampleSize: 5 },
    budgetUsd: 0.9, spentUsd: 0, status: 'completed', createdBy: 'u-1', createdAt: '2026-11-11T08:00:00.000Z',
    startedAt: null, completedAt: null, acceptance: null,
  };
}

function runSummary(id: string, variant: { model?: string; prompt?: string } | null, passRate: number) {
  return {
    evalRun: evalRun(id, variant),
    evaluators: [{ evaluatorId: EVALUATOR_ID, name: 'findings-present', counted: true, passRate, wilsonLower: passRate - 0.2, wilsonUpper: Math.min(1, passRate + 0.1) }],
    scoredTrials: 18, meanAgentCostUsd: 0.12, meanJudgeCostUsd: 0.01, meanDurationMs: 4200, inputTokens: 9000, outputTokens: 1200, acceptance: null,
  };
}

const OUTPUT = {
  comparison: {
    namespace: 'pharma-a', workflowName: 'ae-grading', stepId: 'grade-aes', agentId: null, id: COMPARISON_ID,
    datasetVersionId: DATASET_ID, trialsPerCase: 3, baselineEvalRunId: BASELINE_ID, baselineReused: true,
    status: 'completed', budgetUsd: 1.8, createdBy: 'u-1', createdAt: '2026-11-11T08:00:00.000Z', startedAt: null, completedAt: null,
  },
  baseline: runSummary(BASELINE_ID, null, 0.5),
  variants: [{
    ...runSummary(VARIANT_ID, { model: 'anthropic/claude-haiku-4.5' }, 0.9),
    calls: [{ evaluatorId: EVALUATOR_ID, scope: 'all', wins: 7, losses: 0, ties: 3, pValue: 0.015625, call: 'better' }],
    recommendationScope: 'all',
  }],
};

describe('mediforce eval compare-*', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('compare-prepare sends one model Variant per --model and says how to start it', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(OUTPUT, 201));
    const output = captureOutput();
    const argv = [...STEP_ARGV, '--model', 'anthropic/claude-haiku-4.5,openai/gpt-4o', '--trials', '3', ...BASE];
    expect(await evalComparePrepareCommand({ argv, env: ENV, output })).toBe(0);

    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe('http://localhost:5555/api/evaluation/comparisons');
    expect(JSON.parse(String(init?.body))).toMatchObject({
      stepId: 'grade-aes',
      trialsPerCase: 3,
      variants: [{ model: 'anthropic/claude-haiku-4.5' }, { model: 'openai/gpt-4o' }],
    });
    expect(output.stdoutLines.join('\n')).toContain(`mediforce eval compare-start ${COMPARISON_ID} --confirm-budget 1.8`);
  });

  it('compare-prepare reads Variants from a JSON file and refuses one that is not a list of Variants', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'eval-compare-'));
    const good = join(dir, 'variants.json');
    writeFileSync(good, JSON.stringify([{ prompt: 'Grade every AE by CTCAE v5.' }]));
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(OUTPUT, 201));
    expect(await evalComparePrepareCommand({ argv: [...STEP_ARGV, '--variants', good, ...BASE], env: ENV, output: captureOutput() })).toBe(0);
    expect(JSON.parse(String(fetchSpy.mock.calls[0]![1]?.body))).toMatchObject({ variants: [{ prompt: 'Grade every AE by CTCAE v5.' }] });

    const bad = join(dir, 'bad.json');
    writeFileSync(bad, JSON.stringify({ model: 'openai/gpt-4o' }));
    fetchSpy.mockClear();
    const output = captureOutput();
    expect(await evalComparePrepareCommand({ argv: [...STEP_ARGV, '--variants', bad, ...BASE], env: ENV, output })).not.toBe(0);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(output.stderrLines.join('\n')).toContain(`${bad} is not a list of Variants`);
  });

  it('compare-prepare needs at least one Variant', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const output = captureOutput();
    expect(await evalComparePrepareCommand({ argv: [...STEP_ARGV, ...BASE], env: ENV, output })).toBe(2);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('compare-start sends the confirmed budget', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(OUTPUT));
    const argv = [COMPARISON_ID, '--confirm-budget', '1.8', ...BASE];
    expect(await evalCompareStartCommand({ argv, env: ENV, output: captureOutput() })).toBe(0);
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe(`http://localhost:5555/api/evaluation/comparisons/${COMPARISON_ID}/start`);
    expect(JSON.parse(String(init?.body))).toEqual({ confirmedBudgetUsd: 1.8 });
  });

  it('compare-get prints each Variant\'s call against the baseline', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(OUTPUT));
    const output = captureOutput();
    expect(await evalCompareGetCommand({ argv: [COMPARISON_ID, ...BASE], env: ENV, output })).toBe(0);
    const printed = output.stdoutLines.join('\n');
    expect(printed).toContain('baseline (reused)');
    expect(printed).toContain('model anthropic/claude-haiku-4.5');
    expect(printed).toContain('findings-present');
    expect(printed).toContain('better');
    expect(printed).toContain('7 wins, 0 losses, 3 ties');
  });
});
