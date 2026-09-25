import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { evalApplyVariantCommand, evalRunFailuresCommand, evalRunPrepareCommand, evalRunStartCommand } from '../commands/eval-runs';
import { evalAskCommand } from '../commands/eval-ask';
import { captureOutput, jsonResponse } from './test-helpers';

const ENV = { MEDIFORCE_API_KEY: 'k' };
const BASE = ['--base-url', 'http://localhost:5555'];
const RUN_ID = '0e2a3c4d-5b6f-4a1e-9c8d-7b6a5f4e3d2c';

const OUTPUT = {
  evalRun: {
    namespace: 'pharma-a', workflowName: 'ae-grading', stepId: 'grade-aes', id: RUN_ID, definitionVersion: 2,
    datasetVersionId: '1e2a3c4d-5b6f-4a1e-9c8d-7b6a5f4e3d2c', caseIds: ['2e2a3c4d-5b6f-4a1e-9c8d-7b6a5f4e3d2c'], exampleCaseIds: [],
    trialsPerCase: 3, concurrency: 2,
    evaluators: [{ evaluatorId: '3e2a3c4d-5b6f-4a1e-9c8d-7b6a5f4e3d2c', name: 'findings-present', version: 1, kind: 'schema', severity: 'critical', counted: true }],
    variants: [{ id: 'champion', label: 'Current step', patch: {}, fingerprint: null }],
    acceptanceCriteria: { critical: { minPassRate: 0.9 } }, briefVersion: 1,
    mcpPolicy: {}, estimate: { perTrialUsd: 0.2, totalUsd: 0.6, basis: 'history', sampleSize: 5 },
    budgetUsd: 0.9, spentUsd: 0, status: 'prepared', createdBy: 'u-1', createdAt: '2026-09-23T08:00:00.000Z',
    startedAt: null, completedAt: null,
  },
  trials: [],
  report: {
    k: 3, trials: { total: 3, scored: 0, failed: 0, skipped: 0, inProgress: 3 },
    variants: [{
      id: 'champion', label: 'Current step', patch: {}, fingerprint: null,
      trials: { total: 3, scored: 0, failed: 0, skipped: 0, inProgress: 3 },
      evaluators: [{
        evaluatorId: '3e2a3c4d-5b6f-4a1e-9c8d-7b6a5f4e3d2c', name: 'findings-present', version: 1, kind: 'schema', severity: 'critical', counted: true,
        passes: 0, failures: 0, errors: 0, passRate: null, wilsonLower: null, wilsonUpper: null, passAtK: null, passHatK: null, flakiness: null,
      }],
      suites: [{
        suite: 'phi_leak', evaluators: ['no-phi'], passes: 3, failures: 1, errors: 0, passRate: 0.75, wilsonLower: 0.3, wilsonUpper: 0.95,
      }],
      criteria: [{
        severity: 'critical', criterion: { minPassRate: 0.9 }, status: 'not_evaluable',
        evaluators: [{ evaluatorId: '3e2a3c4d-5b6f-4a1e-9c8d-7b6a5f4e3d2c', name: 'findings-present', wilsonLower: null, passHatK: null, met: null }],
        reason: 'findings-present graded no trial',
      }],
      confidence: null, recommendation: null,
      costUsd: 0, meanCostUsd: null, inputTokens: 0, outputTokens: 0, meanDurationMs: null, maxDurationMs: null,
    }],
    comparison: [],
    costUsd: 0, inputTokens: 0, outputTokens: 0,
  },
};

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('mediforce eval runs', () => {
  it('run-prepare posts the step and trial count, and prints how to start with the budget', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(OUTPUT, 201));
    const output = captureOutput();
    const challengers = join(mkdtempSync(join(tmpdir(), 'eval-cli-')), 'challengers.json');
    writeFileSync(challengers, JSON.stringify([{ label: 'GPT-5', patch: { model: 'openai/gpt-5' } }]));
    const code = await evalRunPrepareCommand({
      argv: ['--namespace', 'pharma-a', '--workflow', 'ae-grading', '--step', 'grade-aes', '--trials', '3', '--challengers', challengers, ...BASE],
      env: ENV,
      output,
    });

    expect(code).toBe(0);
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe('http://localhost:5555/api/evaluation/runs');
    expect(JSON.parse(String(init?.body))).toMatchObject({
      namespace: 'pharma-a', workflowName: 'ae-grading', stepId: 'grade-aes', trialsPerCase: 3,
      challengers: [{ label: 'GPT-5', patch: { model: 'openai/gpt-5' } }],
    });
    const printed = output.stdoutLines.join('\n');
    expect(printed).toContain('criterion critical: not evaluable — findings-present graded no trial');
    expect(printed).toContain('suite phi_leak');
    expect(printed).toContain('3 passed, 1 failed, 0 not graded');
    expect(printed).toContain(`mediforce eval run-start ${RUN_ID} --confirm-budget 0.9`);
    expect(printed).not.toContain('left out');
  });

  it('run-start sends the confirmed budget, and says how many cases few-shot examples left out', async () => {
    const running = { ...OUTPUT.evalRun, status: 'running', exampleCaseIds: ['6e2a3c4d-5b6f-4a1e-9c8d-7b6a5f4e3d2c'] };
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ ...OUTPUT, evalRun: running }));
    const output = captureOutput();
    const code = await evalRunStartCommand({ argv: [RUN_ID, '--confirm-budget', '0.9', ...BASE], env: ENV, output });

    expect(code).toBe(0);
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe(`http://localhost:5555/api/evaluation/runs/${RUN_ID}/start`);
    expect(JSON.parse(String(init?.body))).toEqual({ confirmedBudgetUsd: 0.9 });
    expect(output.stdoutLines).toContain("1 case(s) left out: a variant's few-shot examples came from them");
  });
});

describe('mediforce eval ask', () => {
  it('sends the question for the step and prints proposals without applying them', async () => {
    const { evalAskCommand } = await import('../commands/eval-ask');
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({
      reply: 'Start with a schema check.',
      proposals: [{ tool: 'propose_brief', arguments: { text: 'Grades AEs for the DSMB.' } }],
      preparedEvalRuns: [],
      startedEvalRuns: [],
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

const STEP_ARGV = ['--namespace', 'pharma-a', '--workflow', 'ae-grading', '--step', 'grade-aes'];
const HASH = 'a'.repeat(64);
const TRIAL_ID = '4e2a3c4d-5b6f-4a1e-9c8d-7b6a5f4e3d2c';

describe('mediforce eval failures', () => {
  const failures = {
    evalRunId: RUN_ID, variantId: 'challenger-1', variantLabel: 'GPT-5', total: 2,
    failures: [{
      trialId: TRIAL_ID, trialIndex: 0, status: 'scored', caseId: '2e2a3c4d-5b6f-4a1e-9c8d-7b6a5f4e3d2c', caseName: 'Grade 5 sepsis',
      split: 'dev', expectation: 'positive', caseNotes: 'Must grade the death as 5.', agentRunId: 'agent-run-1', error: null,
      evaluators: [{
        evaluatorId: '3e2a3c4d-5b6f-4a1e-9c8d-7b6a5f4e3d2c', name: 'findings-present', severity: 'critical', kind: 'schema',
        counted: true, outcome: 'failed', comment: 'findings missing', error: null,
      }],
    }],
  };

  it('asks for the variant given and prints each failing trial with its case and Evaluators', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(failures));
    const output = captureOutput();
    const code = await evalRunFailuresCommand({ argv: [RUN_ID, '--variant', 'challenger-1', '--limit', '1', ...BASE], env: ENV, output });

    expect(code).toBe(0);
    expect(fetchSpy.mock.calls[0]![0]).toBe(`http://localhost:5555/api/evaluation/runs/${RUN_ID}/failures?variantId=challenger-1&limit=1`);
    const printed = output.stdoutLines.join('\n');
    expect(printed).toContain('challenger-1 — GPT-5: 2 failing trial(s), showing 1');
    expect(printed).toContain('case "Grade 5 sepsis" (dev, positive)');
    expect(printed).toContain('failed findings-present (critical schema, counted): findings missing');
  });

  it('rejects a limit that is not a positive integer', async () => {
    const output = captureOutput();
    expect(await evalRunFailuresCommand({ argv: [RUN_ID, '--limit', '0', ...BASE], env: ENV, output })).toBe(2);
  });
});

describe('mediforce eval apply-variant', () => {
  const applied = {
    definitionVersion: 3, runnable: false,
    fingerprint: { hash: HASH, components: { step: HASH, model: HASH, systemPrompt: HASH, skill: HASH, image: HASH, mcpServers: HASH, preamble: HASH } },
    variant: { evalRunId: RUN_ID, variantId: 'challenger-1', label: 'GPT-5', matchesFingerprint: true, changed: [] },
  };

  it('applies a challenger of a run, and says the qualification carries over', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(applied, 201));
    const output = captureOutput();
    const code = await evalApplyVariantCommand({ argv: [...STEP_ARGV, '--run', RUN_ID, '--variant', 'challenger-1', '--set-default', ...BASE], env: ENV, output });

    expect(code).toBe(0);
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe('http://localhost:5555/api/evaluation/variants/apply');
    expect(JSON.parse(String(init?.body))).toMatchObject({
      namespace: 'pharma-a', workflowName: 'ae-grading', stepId: 'grade-aes', evalRunId: RUN_ID, variantId: 'challenger-1', setAsDefault: true,
    });
    const printed = output.stdoutLines.join('\n');
    expect(printed).toContain('saved as v3');
    expect(printed).toContain("matches challenger-1's fingerprint — a qualification of it carries over");
  });

  it('applies a patch from a file', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ ...applied, variant: null }, 201));
    const file = join(mkdtempSync(join(tmpdir(), 'eval-cli-')), 'patch.json');
    writeFileSync(file, JSON.stringify({ prompt: 'Fatal is grade 5.' }));
    const output = captureOutput();

    expect(await evalApplyVariantCommand({ argv: [...STEP_ARGV, '--patch', file, ...BASE], env: ENV, output })).toBe(0);
    expect(JSON.parse(String(fetchSpy.mock.calls[0]![1]?.body))).toMatchObject({ patch: { prompt: 'Fatal is grade 5.' } });
  });

  it('wants a run and variant, or a patch — not both, not neither', async () => {
    const output = captureOutput();
    expect(await evalApplyVariantCommand({ argv: [...STEP_ARGV, ...BASE], env: ENV, output })).toBe(2);
    expect(await evalApplyVariantCommand({ argv: [...STEP_ARGV, '--run', RUN_ID, ...BASE], env: ENV, output })).toBe(2);
    expect(await evalApplyVariantCommand({ argv: [...STEP_ARGV, '--run', RUN_ID, '--variant', 'challenger-1', '--patch', 'p.json', ...BASE], env: ENV, output })).toBe(2);
  });
});

describe('mediforce eval ask --unattended-budget', () => {
  const reply = { reply: 'Started it.', proposals: [], preparedEvalRuns: [], startedEvalRuns: [{ evalRunId: RUN_ID, budgetUsd: 2 }] };

  it('sends the grant and prints the runs it started', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(reply));
    const output = captureOutput();
    const code = await evalAskCommand({ argv: [...STEP_ARGV, 'Try a stricter prompt', '--unattended-budget', '3', ...BASE], env: ENV, output });

    expect(code).toBe(0);
    expect(JSON.parse(String(fetchSpy.mock.calls[0]![1]?.body))).toMatchObject({ unattendedBudgetUsd: 3 });
    expect(output.stdoutLines.join('\n')).toContain(`started Eval Run ${RUN_ID} under the unattended budget (up to $2)`);
  });

  it('sends no grant by default, and refuses a budget that is not a positive number', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ ...reply, startedEvalRuns: [] }));
    const output = captureOutput();
    await evalAskCommand({ argv: [...STEP_ARGV, 'Hello', ...BASE], env: ENV, output });
    expect(JSON.parse(String(fetchSpy.mock.calls[0]![1]?.body))).not.toHaveProperty('unattendedBudgetUsd');
    expect(await evalAskCommand({ argv: [...STEP_ARGV, 'Hello', '--unattended-budget', '-1', ...BASE], env: ENV, output })).toBe(2);
  });
});
