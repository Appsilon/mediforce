import { describe, it, expect, vi, beforeEach } from 'vitest';
import { evalRunFailuresCommand, evalRunGetCommand, evalRunPrepareCommand, evalRunStartCommand, evalTrialCommand } from '../commands/eval-runs';
import { evalAskCommand } from '../commands/eval-ask';
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
    fingerprint: null,
    acceptanceCriteria: { critical: { minPassRate: 0.9 } },
    mcpPolicy: {}, estimate: { perTrialUsd: 0.2, totalUsd: 0.6, basis: 'history', sampleSize: 5 },
    budgetUsd: 0.9, spentUsd: 0, status: 'prepared', createdBy: 'u-1', createdAt: '2026-09-23T08:00:00.000Z',
    startedAt: null, completedAt: null, acceptance: null,
  },
  trials: [],
  report: {
    k: 3, trials: { total: 3, scored: 0, failed: 0, skipped: 0, inProgress: 3 },
    mcp: { live: [], replayed: ['edc'], denied: [], recordedFirst: [], unrecordedCalls: [] },
    evaluators: [{
      evaluatorId: '3e2a3c4d-5b6f-4a1e-9c8d-7b6a5f4e3d2c', name: 'findings-present', version: 1, kind: 'schema', severity: 'critical', counted: true,
      passes: 0, failures: 0, errors: 0, excluded: 0, passRate: null, wilsonLower: null, wilsonUpper: null, passAtK: null, passHatK: null, flakiness: null,
    }],
    criteria: [{
      severity: 'critical', criterion: { minPassRate: 0.9 }, status: 'not_evaluable',
      evaluators: [{ evaluatorId: '3e2a3c4d-5b6f-4a1e-9c8d-7b6a5f4e3d2c', name: 'findings-present', wilsonLower: null, passHatK: null, met: null }],
      reason: 'findings-present graded no trial',
    }],
    confidence: null, recommendation: null,
    judgeVerdicts: [],
    trialResults: [],
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
    expect(JSON.parse(String(init?.body))).toMatchObject({
      namespace: 'pharma-a', workflowName: 'ae-grading', stepId: 'grade-aes', trialsPerCase: 3,
    });
    const printed = output.stdoutLines.join('\n');
    expect(printed).toContain('criterion critical: not evaluable — findings-present graded no trial');
    expect(printed).toContain('MCP servers: edc replayed. No trial made a live MCP call.');
    expect(printed).toContain(`mediforce eval run-start ${RUN_ID} --confirm-budget 0.9`);
  });

  it('run-prepare --version prepares that version\'s step, and refuses one that is not a positive integer', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(OUTPUT, 201));
    const output = captureOutput();
    expect(await evalRunPrepareCommand({ argv: [...STEP_ARGV, '--version', '1', ...BASE], env: ENV, output })).toBe(0);
    expect(JSON.parse(String(fetchSpy.mock.calls[0]![1]?.body))).toMatchObject({ stepId: 'grade-aes', definitionVersion: 1 });

    expect(await evalRunPrepareCommand({ argv: [...STEP_ARGV, '--version', 'v1', ...BASE], env: ENV, output })).toBe(2);
    expect(output.stderrLines).toContain('--trials, --concurrency and --version must be positive integers');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('run-start sends the confirmed budget', async () => {
    const running = { ...OUTPUT.evalRun, status: 'running' };
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ ...OUTPUT, evalRun: running }));
    const output = captureOutput();
    const code = await evalRunStartCommand({ argv: [RUN_ID, '--confirm-budget', '0.9', ...BASE], env: ENV, output });

    expect(code).toBe(0);
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe(`http://localhost:5555/api/evaluation/runs/${RUN_ID}/start`);
    expect(JSON.parse(String(init?.body))).toEqual({ confirmedBudgetUsd: 0.9 });
  });

  it('report lists the model verdicts left out of the criteria and how to review them', async () => {
    const judgeId = '5e2a3c4d-5b6f-4a1e-9c8d-7b6a5f4e3d2c';
    const verdict = {
      trialId: TRIAL_ID, trialIndex: 0, caseId: '2e2a3c4d-5b6f-4a1e-9c8d-7b6a5f4e3d2c', caseName: 'Grade 5 sepsis',
      agentRunId: 'agent-run-1', evaluatorId: judgeId, name: 'death-graded-5', severity: 'critical', scoreId: '7e2a3c4d-5b6f-4a1e-9c8d-7b6a5f4e3d2c',
      passed: false, confidence: 0.4, minConfidence: 0.8, agreement: null, rationale: 'Grade 4 given for a fatal AE.', review: null, counts: false,
    };
    const judgeReport = {
      ...OUTPUT.report.evaluators[0]!,
      evaluatorId: judgeId, name: 'death-graded-5', kind: 'llm_judge', passes: 0, failures: 0, excluded: 1,
    };
    const report = {
      ...OUTPUT.report,
      evaluators: [judgeReport],
      judgeVerdicts: [verdict, { ...verdict, trialIndex: 1, trialId: '8e2a3c4d-5b6f-4a1e-9c8d-7b6a5f4e3d2c', confidence: 0.95, counts: true }],
    };
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ ...OUTPUT, report }));
    const output = captureOutput();

    expect(await evalRunGetCommand({ argv: [RUN_ID, ...BASE], env: ENV, output })).toBe(0);
    const printed = output.stdoutLines.join('\n');
    expect(printed).toContain('1 model verdict(s) left out');
    expect(printed).toContain(`mediforce eval judge-review ${RUN_ID} --trial <id> --evaluator <id> --accept|--deny`);
    expect(printed).toContain(`trial ${TRIAL_ID}  death-graded-5 (${judgeId})  fail, confidence 0.40 < 0.8  "Grade 5 sepsis"`);
    expect(printed).not.toContain('8e2a3c4d');
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
    evalRunId: RUN_ID, total: 2,
    failures: [{
      trialId: TRIAL_ID, trialIndex: 0, status: 'scored', caseId: '2e2a3c4d-5b6f-4a1e-9c8d-7b6a5f4e3d2c', caseName: 'Grade 5 sepsis',
      split: 'dev', expectation: 'negative', expectedOutput: { findings: [{ term: 'Sepsis', grade: 4 }] }, agentRunId: 'agent-run-1', error: null,
      evaluators: [{
        evaluatorId: '3e2a3c4d-5b6f-4a1e-9c8d-7b6a5f4e3d2c', name: 'findings-present', severity: 'critical', kind: 'schema',
        counted: true, outcome: 'failed', comment: 'findings missing', error: null,
      }],
    }],
  };

  it('asks for the limit given and prints each failing trial with its case and Evaluators', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse(failures));
    const output = captureOutput();
    const code = await evalRunFailuresCommand({ argv: [RUN_ID, '--limit', '1', ...BASE], env: ENV, output });

    expect(code).toBe(0);
    expect(fetchSpy.mock.calls[0]![0]).toBe(`http://localhost:5555/api/evaluation/runs/${RUN_ID}/failures?limit=1`);
    const printed = output.stdoutLines.join('\n');
    expect(printed).toContain('2 failing trial(s), showing 1');
    expect(printed).toContain('case "Grade 5 sepsis" (dev, negative)');
    expect(printed).toContain('expected output (to avoid): {"findings":[{"term":"Sepsis","grade":4}]}');
    expect(printed).toContain('failed findings-present (critical schema, counted): findings missing');
  });

  it('rejects a limit that is not a positive integer', async () => {
    const output = captureOutput();
    expect(await evalRunFailuresCommand({ argv: [RUN_ID, '--limit', '0', ...BASE], env: ENV, output })).toBe(2);
  });
});

describe('mediforce eval trial', () => {
  const judgeId = '5e2a3c4d-5b6f-4a1e-9c8d-7b6a5f4e3d2c';
  const trial = {
    trial: {
      id: TRIAL_ID, evalRunId: RUN_ID, caseId: '2e2a3c4d-5b6f-4a1e-9c8d-7b6a5f4e3d2c', trialIndex: 0, status: 'scored',
      processInstanceId: 'trial-run', agentRunId: 'agent-run-1', costUsd: 0.1, inputTokens: 100, outputTokens: 10, durationMs: 1000,
      confidence: 0.7, error: null, startedAt: null, scoringStartedAt: null, scoringAttempts: 1, completedAt: null, mcpReplayMisses: [], erroredJudgeCalls: {},
    },
    evalCase: null,
    stepInput: { events: [{ term: 'Sepsis' }] },
    result: { findings: [{ term: 'Sepsis', grade: 4 }] },
    reasoningSummary: 'Graded by CTCAE v5.',
    trajectory: [],
    evaluators: [{
      evaluator: { evaluatorId: judgeId, name: 'death-graded-5', version: 2, kind: 'llm_judge', severity: 'critical', counted: true },
      rule: 'A fatal AE is Grade 5.',
      check: { kind: 'llm_judge', model: 'anthropic/claude-haiku-4.5', rubric: 'A fatal AE is Grade 5.', minConfidence: 0.8 },
      outcome: 'fail',
      score: { value: 0, label: 'fail', comment: 'Grade 4 given for a fatal AE.', confidence: 0.9, minConfidence: 0.8, agreement: null },
      error: null,
      review: null,
      judgePrompt: [{ role: 'system', content: 'Rubric:\nA fatal AE is Grade 5.' }, { role: 'user', content: 'Step output: ...' }],
      judgeCalls: [{ model: 'anthropic/claude-haiku-4.5', promptTokens: 900, completionTokens: 60, durationMs: 1200, response: '{"rationale": "Grade 4 given for a fatal AE.", "passed": false, "confidence": 0.9}' }],
    }],
  };

  it('prints the trial\'s input and output and each Evaluator\'s grade, and the judge prompt and answer only with --prompts', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => jsonResponse(trial));
    const output = captureOutput();
    expect(await evalTrialCommand({ argv: [RUN_ID, TRIAL_ID, ...BASE], env: ENV, output })).toBe(0);

    expect(fetchSpy.mock.calls[0]![0]).toBe(`http://localhost:5555/api/evaluation/runs/${RUN_ID}/trials/${TRIAL_ID}`);
    const printed = output.stdoutLines.join('\n');
    expect(printed).toContain('output: {"findings":[{"term":"Sepsis","grade":4}]}');
    expect(printed).toContain('fail  death-graded-5 v2 (critical llm_judge, confidence 0.9)');
    expect(printed).toContain('Grade 4 given for a fatal AE.');
    expect(printed).not.toContain('Rubric:');

    const withPrompts = captureOutput();
    await evalTrialCommand({ argv: [RUN_ID, TRIAL_ID, '--prompts', ...BASE], env: ENV, output: withPrompts });
    expect(withPrompts.stdoutLines.join('\n')).toContain('--- system ---\nRubric:\nA fatal AE is Grade 5.');
    expect(withPrompts.stdoutLines.join('\n')).toContain('--- assistant (anthropic/claude-haiku-4.5, 900 in / 60 out tokens, 1200 ms) ---\n{"rationale": "Grade 4 given for a fatal AE."');
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

  it('asks about the step as --version has it, and refuses a version that is not a positive integer', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ ...reply, startedEvalRuns: [] }));
    const output = captureOutput();
    expect(await evalAskCommand({ argv: [...STEP_ARGV, 'Hello', '--version', '2', ...BASE], env: ENV, output })).toBe(0);
    expect(JSON.parse(String(fetchSpy.mock.calls[0]![1]?.body))).toMatchObject({ definitionVersion: 2 });
    expect(await evalAskCommand({ argv: [...STEP_ARGV, 'Hello', '--version', '0', ...BASE], env: ENV, output })).toBe(2);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('sends no grant by default, and refuses a budget that is not a positive number', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse({ ...reply, startedEvalRuns: [] }));
    const output = captureOutput();
    await evalAskCommand({ argv: [...STEP_ARGV, 'Hello', ...BASE], env: ENV, output });
    expect(JSON.parse(String(fetchSpy.mock.calls[0]![1]?.body))).not.toHaveProperty('unattendedBudgetUsd');
    expect(await evalAskCommand({ argv: [...STEP_ARGV, 'Hello', '--unattended-budget', '-1', ...BASE], env: ENV, output })).toBe(2);
  });
});
