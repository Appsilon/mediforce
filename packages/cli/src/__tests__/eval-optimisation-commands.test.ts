import { describe, it, expect, vi, beforeEach } from 'vitest';
import { evalOptimiseCommand, evalOptimisationGetCommand, evalOptimisationListCommand } from '../commands/eval-optimisations';
import { captureOutput, jsonResponse } from './test-helpers';

const ENV = { MEDIFORCE_API_KEY: 'k' };
const BASE = ['--base-url', 'http://localhost:5555'];
const STEP_ARGV = ['--namespace', 'pharma-a', '--workflow', 'ae-grading', '--step', 'grade-aes'];
const OPTIMISATION_ID = '4e2a3c4d-5b6f-4a1e-9c8d-7b6a5f4e3d2c';
const SOURCE_RUN_ID = '0e2a3c4d-5b6f-4a1e-9c8d-7b6a5f4e3d2c';
const CANDIDATE_RUN_ID = '5e2a3c4d-5b6f-4a1e-9c8d-7b6a5f4e3d2c';

const optimisation = {
  namespace: 'pharma-a', workflowName: 'ae-grading', stepId: 'grade-aes', id: OPTIMISATION_ID,
  sourceEvalRunId: SOURCE_RUN_ID, sourceVariantId: 'champion', basePatch: {},
  reflectionModel: 'anthropic/claude-sonnet-4', candidateCount: 2, trialsPerCase: 1, budgetUsd: 5,
  jobCostUsd: 0.03,
  candidates: [
    { variantId: 'challenger-1', label: 'GEPA candidate 1', prompt: 'Grade by CTCAE v5; fatal is grade 5.', reflectedOn: 2 },
    { variantId: 'challenger-2', label: 'GEPA candidate 2', prompt: 'List every AE with its grade.', reflectedOn: 2 },
  ],
  evalRunId: CANDIDATE_RUN_ID, status: 'evaluating', error: null, createdBy: 'u-1', createdAt: '2026-09-29T08:00:00.000Z',
};

function split(passes: number, graded: number) {
  return { cases: graded, graded, passes, passRate: passes / graded, wilsonLower: 0.2, wilsonUpper: 0.9 };
}

const OUTPUT = {
  optimisation,
  evalRun: { id: CANDIDATE_RUN_ID, status: 'completed', budgetUsd: 4.97, spentUsd: 1.2 },
  spentUsd: 1.23,
  baseline: { variantId: 'champion', label: 'Current step', prompt: null, dev: split(1, 4), holdout: split(1, 2), meanCostUsd: 0.1 },
  ranking: [
    { rank: 1, variantId: 'challenger-1', label: 'GEPA candidate 1', prompt: 'Grade by CTCAE v5; fatal is grade 5.', dev: split(4, 4), holdout: split(2, 2), meanCostUsd: 0.1 },
    { rank: 2, variantId: 'challenger-2', label: 'GEPA candidate 2', prompt: 'List every AE with its grade.', dev: split(2, 4), holdout: split(1, 2), meanCostUsd: 0.1 },
  ],
};

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('mediforce eval optimise', () => {
  it('posts the step, the source run and the granted budget, and says how to follow it', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({
      ...OUTPUT, optimisation: { ...optimisation, status: 'proposing', jobCostUsd: null, candidates: [], evalRunId: null },
      evalRun: null, spentUsd: 0, baseline: null, ranking: [],
    }, 201));
    const output = captureOutput();
    const code = await evalOptimiseCommand({
      argv: [...STEP_ARGV, '--run', SOURCE_RUN_ID, '--budget', '5', '--candidates', '2', '--reflection-model', 'openai/gpt-5', ...BASE],
      env: ENV,
      output,
    });

    expect(code).toBe(0);
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe('http://localhost:5555/api/evaluation/optimisations');
    expect(JSON.parse(String(init?.body))).toMatchObject({
      namespace: 'pharma-a', workflowName: 'ae-grading', stepId: 'grade-aes',
      evalRunId: SOURCE_RUN_ID, budgetUsd: 5, candidates: 2, reflectionModel: 'openai/gpt-5',
    });
    const printed = output.stdoutLines.join('\n');
    expect(printed).toContain('proposing');
    expect(printed).toContain(`mediforce eval optimisation ${OPTIMISATION_ID}`);
  });

  it('refuses a budget that is not a positive number', async () => {
    const output = captureOutput();
    expect(await evalOptimiseCommand({ argv: [...STEP_ARGV, '--run', SOURCE_RUN_ID, '--budget', '0', ...BASE], env: ENV, output })).toBe(2);
    expect(await evalOptimiseCommand({ argv: [...STEP_ARGV, '--run', SOURCE_RUN_ID, '--budget', 'lots', ...BASE], env: ENV, output })).toBe(2);
  });
});

describe('mediforce eval optimisation', () => {
  it('prints the baseline and the candidates ranked, with their prompts and how to apply one', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(OUTPUT));
    const output = captureOutput();

    expect(await evalOptimisationGetCommand({ argv: [OPTIMISATION_ID, ...BASE], env: ENV, output })).toBe(0);
    expect(fetchSpy.mock.calls[0]![0]).toBe(`http://localhost:5555/api/evaluation/optimisations/${OPTIMISATION_ID}`);
    const printed = output.stdoutLines.join('\n');
    expect(printed).toContain('baseline  Current step  dev 1/4 25%');
    expect(printed).toContain('#1 challenger-1 — GEPA candidate 1  dev 4/4 100% [20–90%]  holdout 2/2 100%');
    expect(printed).toContain('Grade by CTCAE v5; fatal is grade 5.');
    expect(printed.indexOf('#1 challenger-1')).toBeLessThan(printed.indexOf('#2 challenger-2'));
    expect(printed).toContain(`mediforce eval apply-variant --run ${CANDIDATE_RUN_ID} --variant <variantId>`);
  });
});

describe('mediforce eval optimisations', () => {
  it('lists the step\'s optimisations', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ optimisations: [optimisation] }));
    const output = captureOutput();

    expect(await evalOptimisationListCommand({ argv: [...STEP_ARGV, ...BASE], env: ENV, output })).toBe(0);
    expect(String(fetchSpy.mock.calls[0]![0])).toContain('/api/evaluation/optimisations?namespace=pharma-a');
    expect(output.stdoutLines.join('\n')).toContain(`${OPTIMISATION_ID}  evaluating`);
  });
});
