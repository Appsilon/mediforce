import { describe, it, expect, afterEach, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { InMemoryAgentTrajectoryRepository, buildAgentRun } from '@mediforce/platform-core/testing';
import { OPENROUTER_KEY_MISSING_MESSAGE } from '../../../../services/openrouter-key';
import { runEvaluatorCheck } from '../run-evaluator-check';
import { loadScoredRun } from '../scored-run';
import { createEvalCase } from '../../eval-cases';
import { CreateEvalCaseInputSchema } from '../../../../contract/evaluation';
import { evaluationFixture, GRADED_RUN, registryEntry, STEP, type EvaluationFixture } from '../../__tests__/fixture';

const judge = {
  kind: 'llm_judge' as const,
  model: 'anthropic/claude-haiku-4.5',
  rubric: 'Every AE carries a grade.',
  minConfidence: 0.8,
};

const ANSWER = '{"rationale": "Sepsis is graded 5, as the fatal outcome requires.", "passed": true, "confidence": 0.85}';

const expected = {
  kind: 'expected_output' as const,
  model: 'anthropic/claude-haiku-4.5',
  instructions: 'Wording is never decisive.',
  minAgreement: 0.8,
  maxAgreement: 0.2,
};

/** GRADED_RUN returned `{ findings: [{ term: 'Sepsis', grade: 5 }] }`. */
async function caseExpecting(fixture: EvaluationFixture, label: Record<string, unknown>) {
  const { evalCase } = await createEvalCase(CreateEvalCaseInputSchema.parse({
    ...STEP, name: 'Grade 5 sepsis', input: { triggerPayload: { studyId: 'CDISCPILOT01' }, previousStepOutputs: {} }, ...label,
  }), fixture.scope());
  return evalCase;
}

function answeringOpenRouter(content: string) {
  const fetchMock = vi.fn().mockImplementation(async () => new Response(JSON.stringify({ choices: [{ message: { content }, finish_reason: 'stop' }] })));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function withOpenRouterKey(fixture: EvaluationFixture) {
  const scope = fixture.scope();
  Object.assign(scope, { workspaceSecrets: { getSecrets: async () => ({ OPENROUTER_API_KEY: 'sk-test' }) } });
  return scope;
}

describe('runEvaluatorCheck', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('fails every check on a run that produced no result, without running it', async () => {
    const fixture = await evaluationFixture();
    await fixture.agentRunRepo.create(buildAgentRun({
      id: 'errored', processInstanceId: 'run-graded', stepId: 'grade-aes', status: 'error', envelope: null,
    }));
    const subject = await loadScoredRun(fixture.scope(), 'errored', STEP);
    const outcome = await runEvaluatorCheck(fixture.scope(), judge, subject, null);
    expect(outcome).toEqual({
      agentRunId: 'errored', passed: false, value: 0, label: 'fail', confidence: null, agreement: null,
      comment: 'The Agent Run produced no result (status: error)', error: null,
    });
  });

  it('asks the judge through the platform\'s OpenRouter seam, with the agent\'s log, and keeps its confidence and rationale', async () => {
    const fixture = await evaluationFixture();
    const fetchMock = vi.fn().mockImplementation(async () => new Response(JSON.stringify({
      choices: [{ message: { content: ANSWER }, finish_reason: 'stop' }],
    })));
    vi.stubGlobal('fetch', fetchMock);
    const agentTrajectoryRepo = new InMemoryAgentTrajectoryRepository(fixture.agentRunRepo);
    await agentTrajectoryRepo.append(GRADED_RUN, [
      { seq: 0, ts: '2026-09-22T09:00:00.000Z', type: 'assistant', text: 'Sepsis was fatal, so it is grade 5.' },
    ]);
    const scope = fixture.scope(undefined, { agentTrajectoryRepo });
    Object.assign(scope, { workspaceSecrets: { getSecrets: async () => ({ OPENROUTER_API_KEY: 'sk-test' }) } });

    const outcome = await runEvaluatorCheck(scope, judge, await loadScoredRun(scope, GRADED_RUN, STEP), null);

    expect(outcome).toEqual({
      agentRunId: GRADED_RUN, passed: true, value: 1, label: 'pass', confidence: 0.85, agreement: null,
      comment: 'Sepsis is graded 5, as the fatal outcome requires.', error: null,
    });
    const body = JSON.parse(String(fetchMock.mock.calls[0]![1]!.body)) as { model: string; temperature: number; messages: Array<{ content: string }> };
    expect(body).toMatchObject({ model: 'anthropic/claude-haiku-4.5', temperature: 0 });
    expect(body.messages[1]!.content).toContain('Sepsis was fatal, so it is grade 5.');
  });

  it('shows the judge the files the run wrote, as its commit left them, but not its result.json again', async () => {
    const root = await mkdtemp(join(tmpdir(), 'judge-files-'));
    try {
      const worktree = join(root, 'work');
      const bareRepoPath = join(root, 'repo.git');
      execFileSync('git', ['init', '-q', '-b', 'main', worktree]);
      await mkdir(join(worktree, '.mediforce', 'output', 'grade-aes'), { recursive: true });
      await writeFile(join(worktree, '.mediforce', 'output', 'grade-aes', 'report.md'), '# Safety report\nREPORT-BODY-MARKER: sepsis, CTCAE grade 5.');
      await writeFile(join(worktree, '.mediforce', 'output', 'grade-aes', 'result.json'), '{"RESULT-FILE-MARKER": true}');
      execFileSync('git', ['-C', worktree, 'add', '-A']);
      execFileSync('git', ['-C', worktree, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'grade-aes']);
      const commitSha = execFileSync('git', ['-C', worktree, 'rev-parse', 'HEAD'], { encoding: 'utf-8' }).trim();
      execFileSync('git', ['clone', '-q', '--bare', worktree, bareRepoPath]);

      const fixture = await evaluationFixture();
      const graded = await fixture.agentRunRepo.getById(GRADED_RUN);
      await fixture.agentRunRepo.create(buildAgentRun({
        id: 'graded-with-report', processInstanceId: graded!.processInstanceId, stepId: graded!.stepId, status: 'completed',
        envelope: {
          ...graded!.envelope!,
          gitMetadata: {
            commitSha, branch: 'run/run-graded', repoUrl: bareRepoPath,
            changedFiles: ['.mediforce/output/grade-aes/report.md', '.mediforce/output/grade-aes/result.json'],
          },
        },
      }));
      const fetchMock = answeringOpenRouter(ANSWER);
      const scope = withOpenRouterKey(fixture);

      const outcome = await runEvaluatorCheck(scope, judge, await loadScoredRun(scope, 'graded-with-report', STEP), null);

      expect(outcome).toMatchObject({ passed: true, error: null });
      const body = JSON.parse(String(fetchMock.mock.calls[0]![1]!.body)) as { messages: Array<{ content: string }> };
      expect(body.messages[1]!.content).toContain('--- .mediforce/output/grade-aes/report.md\n# Safety report\nREPORT-BODY-MARKER');
      expect(body.messages[1]!.content).not.toContain('RESULT-FILE-MARKER');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('tells an llm_judge neither a case\'s expected output nor whether the case is negative', async () => {
    const fixture = await evaluationFixture();
    const fetchMock = answeringOpenRouter(ANSWER);
    const scope = withOpenRouterKey(fixture);
    const evalCase = await caseExpecting(fixture, { expectedOutput: { marker: 'EXPECTED-OUTPUT-MARKER' }, expectation: 'negative' });

    await runEvaluatorCheck(scope, judge, await loadScoredRun(scope, GRADED_RUN, STEP), evalCase);

    const body = JSON.parse(String(fetchMock.mock.calls[0]![1]!.body)) as { messages: Array<{ content: string }> };
    const prompt = body.messages.map((message) => message.content).join('\n');
    expect(prompt).not.toContain('EXPECTED-OUTPUT-MARKER');
    expect(prompt).not.toMatch(/negative/i);
  });

  describe('expected_output, exact', () => {
    it('passes a positive case only on an output that matches its expected output exactly', async () => {
      const fixture = await evaluationFixture();
      const subject = await loadScoredRun(fixture.scope(), GRADED_RUN, STEP);

      const matching = await caseExpecting(fixture, { expectedOutput: { findings: [{ grade: 5, term: 'Sepsis' }] } });
      expect(await runEvaluatorCheck(fixture.scope(), expected, subject, matching)).toMatchObject({ passed: true, value: 1, agreement: null });

      const differing = await caseExpecting(fixture, { expectedOutput: { findings: [{ term: 'Sepsis', grade: 4 }] } });
      expect(await runEvaluatorCheck(fixture.scope(), expected, subject, differing)).toMatchObject({
        passed: false, comment: expect.stringContaining('findings.0.grade: expected 4, got 5'),
      });
    });

    it('passes a negative case only on an output that differs from its expected output', async () => {
      const fixture = await evaluationFixture();
      const subject = await loadScoredRun(fixture.scope(), GRADED_RUN, STEP);

      const avoided = await caseExpecting(fixture, { expectedOutput: { findings: [{ term: 'Sepsis', grade: 5 }] }, expectation: 'negative' });
      expect(await runEvaluatorCheck(fixture.scope(), expected, subject, avoided)).toMatchObject({ passed: false, comment: expect.stringContaining('must not get') });

      const other = await caseExpecting(fixture, { expectedOutput: { findings: [{ term: 'Sepsis', grade: 1 }] }, expectation: 'negative' });
      expect(await runEvaluatorCheck(fixture.scope(), expected, subject, other)).toMatchObject({ passed: true });
    });

    it('is an error, not a failure, on a case without an expected output', async () => {
      const fixture = await evaluationFixture();
      const subject = await loadScoredRun(fixture.scope(), GRADED_RUN, STEP);
      expect(await runEvaluatorCheck(fixture.scope(), expected, subject, await caseExpecting(fixture, {}))).toMatchObject({
        passed: null, error: expect.stringContaining('has an expected output'),
      });
      expect(await runEvaluatorCheck(fixture.scope(), expected, subject, null)).toMatchObject({ passed: null });
    });
  });

  describe('expected_output, agreement', () => {
    it('asks the agreement judge with the check\'s and the case\'s instructions, and passes at minAgreement', async () => {
      const fixture = await evaluationFixture();
      const fetchMock = answeringOpenRouter('{"rationale": "Same term and grade.", "agreement": 0.9}');
      const scope = withOpenRouterKey(fixture);
      const evalCase = await caseExpecting(fixture, {
        expectedOutput: { findings: [{ term: 'Sepsis (fatal)', grade: 5 }] }, comparison: 'agreement', agreementInstructions: 'The term wording is trivial; the grade is not.',
      });
      const calls: unknown[] = [];

      const outcome = await runEvaluatorCheck(scope, expected, await loadScoredRun(scope, GRADED_RUN, STEP), evalCase, (call) => calls.push(call));

      expect(outcome).toMatchObject({ passed: true, value: 1, agreement: 0.9, comment: expect.stringContaining('Same term and grade.') });
      expect(calls).toHaveLength(1);
      const body = JSON.parse(String(fetchMock.mock.calls[0]![1]!.body)) as { model: string; messages: Array<{ content: string }> };
      expect(body.model).toBe('anthropic/claude-haiku-4.5');
      expect(body.messages[0]!.content).toContain('Wording is never decisive.');
      expect(body.messages[0]!.content).toContain('The term wording is trivial; the grade is not.');
      expect(body.messages[1]!.content).toContain('Sepsis (fatal)');
    });

    it('fails a positive case below minAgreement, and a negative case above maxAgreement', async () => {
      const fixture = await evaluationFixture();
      const scope = withOpenRouterKey(fixture);
      const subject = await loadScoredRun(scope, GRADED_RUN, STEP);
      const label = { expectedOutput: { findings: [{ term: 'Sepsis', grade: 5 }] }, comparison: 'agreement' };

      answeringOpenRouter('{"rationale": "The grade differs.", "agreement": 0.3}');
      expect(await runEvaluatorCheck(scope, expected, subject, await caseExpecting(fixture, label))).toMatchObject({ passed: false, agreement: 0.3 });

      const negative = { ...label, expectation: 'negative' };
      answeringOpenRouter('{"rationale": "Partly the same.", "agreement": 0.5}');
      expect(await runEvaluatorCheck(scope, expected, subject, await caseExpecting(fixture, negative))).toMatchObject({ passed: false, agreement: 0.5 });

      answeringOpenRouter('{"rationale": "The grade differs.", "agreement": 0.2}');
      expect(await runEvaluatorCheck(scope, expected, subject, await caseExpecting(fixture, negative))).toMatchObject({ passed: true, agreement: 0.2 });
    });
  });

  it('reports what a judge call spent and answered even when its answer is unusable', async () => {
    const fixture = await evaluationFixture();
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => new Response(JSON.stringify({
      choices: [{ message: { content: 'I would rather not choose.' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 4000, completion_tokens: 500 },
    }))));
    const scope = fixture.scope();
    Object.assign(scope, { workspaceSecrets: { getSecrets: async () => ({ OPENROUTER_API_KEY: 'sk-test' }) } });
    const calls: unknown[] = [];

    const outcome = await runEvaluatorCheck(scope, judge, await loadScoredRun(scope, GRADED_RUN, STEP), null, (call) => calls.push(call));

    expect(outcome).toMatchObject({ passed: null, value: null });
    expect(calls.length).toBeGreaterThan(0);
    expect(calls[0]).toEqual({
      model: 'anthropic/claude-haiku-4.5', promptTokens: 4000, completionTokens: 500, durationMs: expect.any(Number), response: 'I would rather not choose.',
    });
  });

  it('constrains a judge\'s answer to its schema on a model whose providers can, routed only to those, sending no parameter the model does not take', async () => {
    const fixture = await evaluationFixture();
    await fixture.modelRegistryRepo.upsert(registryEntry(judge.model, { supportedParameters: ['max_tokens', 'response_format', 'structured_outputs'] }));
    const scope = withOpenRouterKey(fixture);
    const subject = await loadScoredRun(scope, GRADED_RUN, STEP);

    const judging = answeringOpenRouter(ANSWER);
    expect(await runEvaluatorCheck(scope, judge, subject, null)).toMatchObject({ passed: true, confidence: 0.85 });
    const judgeBody = JSON.parse(String(judging.mock.calls[0]![1]!.body)) as Record<string, unknown>;
    expect(judgeBody).toMatchObject({
      max_tokens: 16000,
      response_format: { type: 'json_schema', json_schema: { name: 'verdict', strict: true, schema: { required: ['rationale', 'passed', 'confidence'] } } },
      provider: { require_parameters: true },
    });
    expect(judgeBody).not.toHaveProperty('temperature');

    const comparing = answeringOpenRouter('{"rationale": "Same term and grade.", "agreement": 0.9}');
    const evalCase = await caseExpecting(fixture, { expectedOutput: { findings: [{ term: 'Sepsis', grade: 5 }] }, comparison: 'agreement' });
    expect(await runEvaluatorCheck(scope, expected, subject, evalCase)).toMatchObject({ passed: true, agreement: 0.9 });
    expect(JSON.parse(String(comparing.mock.calls[0]![1]!.body))).toMatchObject({
      response_format: { type: 'json_schema', json_schema: { name: 'agreement', strict: true } },
      provider: { require_parameters: true },
    });
  });

  it('asks a judge for an answer at temperature 0 on a model that takes it', async () => {
    const fixture = await evaluationFixture();
    await fixture.modelRegistryRepo.upsert(registryEntry(judge.model, { supportedParameters: ['max_tokens', 'temperature', 'structured_outputs'] }));
    const scope = withOpenRouterKey(fixture);
    const fetchMock = answeringOpenRouter(ANSWER);

    await runEvaluatorCheck(scope, judge, await loadScoredRun(scope, GRADED_RUN, STEP), null);

    expect(JSON.parse(String(fetchMock.mock.calls[0]![1]!.body))).toMatchObject({ temperature: 0, provider: { require_parameters: true } });
  });

  it('asks a judge for no more output tokens than its model allows', async () => {
    for (const [maxCompletionTokens, sent] of [[8192, 8192], [32_000, 16_000], [null, 16_000]] as const) {
      const fixture = await evaluationFixture();
      await fixture.modelRegistryRepo.upsert(registryEntry(judge.model, { maxCompletionTokens }));
      const scope = withOpenRouterKey(fixture);
      const fetchMock = answeringOpenRouter(ANSWER);

      await runEvaluatorCheck(scope, judge, await loadScoredRun(scope, GRADED_RUN, STEP), null);

      expect(JSON.parse(String(fetchMock.mock.calls[0]![1]!.body))).toMatchObject({ max_tokens: sent });
    }
  });

  it('asks a judge on a model the registry does not say can constrain its answer for JSON in text, so a judge saved on one still runs', async () => {
    for (const parameters of [null, undefined, ['max_tokens', 'temperature', 'response_format']]) {
      const fixture = await evaluationFixture();
      if (parameters !== null) await fixture.modelRegistryRepo.upsert(registryEntry(judge.model, parameters === undefined ? {} : { supportedParameters: parameters }));
      const scope = withOpenRouterKey(fixture);
      const fetchMock = answeringOpenRouter(ANSWER);

      expect(await runEvaluatorCheck(scope, judge, await loadScoredRun(scope, GRADED_RUN, STEP), null)).toMatchObject({ passed: true, comment: 'Sepsis is graded 5, as the fatal outcome requires.' });
      const body = JSON.parse(String(fetchMock.mock.calls[0]![1]!.body)) as Record<string, unknown>;
      expect(body).toMatchObject({ max_tokens: 16000, temperature: 0 });
      expect(body.response_format).toBeUndefined();
      expect(body.provider).toBeUndefined();
      expect(body.tools).toBeUndefined();
    }
  });

  it('says a judge answer was cut off at the output-token limit, not that the judge did not judge', async () => {
    const fixture = await evaluationFixture();
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => new Response(JSON.stringify({
      choices: [{ message: { content: '{"rationale": "The report covers' }, finish_reason: 'length' }],
    }))));
    const scope = withOpenRouterKey(fixture);

    const outcome = await runEvaluatorCheck(scope, judge, await loadScoredRun(scope, GRADED_RUN, STEP), null);
    expect(outcome).toMatchObject({ passed: null, error: expect.stringContaining('cut off at the output-token limit') });
  });

  it('reports a judge that spent its whole output-token limit on reasoning, and what that call spent', async () => {
    const fixture = await evaluationFixture();
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => new Response(JSON.stringify({
      choices: [{ message: { content: '' }, finish_reason: 'length' }],
      usage: { prompt_tokens: 6239, completion_tokens: 16000, completion_tokens_details: { reasoning_tokens: 16000 } },
    }))));
    const scope = withOpenRouterKey(fixture);
    const calls: unknown[] = [];

    const outcome = await runEvaluatorCheck(scope, judge, await loadScoredRun(scope, GRADED_RUN, STEP), null, (call) => calls.push(call));

    expect(outcome).toMatchObject({ passed: null, error: 'the judge used up its output-token limit before writing any answer (16000 tokens, 16000 of them reasoning)' });
    expect(calls[0]).toMatchObject({ completionTokens: 16000, reasoningTokens: 16000, response: '' });
  });

  it('asks a rate-limited or failing provider once more before reporting the provider\'s error', async () => {
    vi.useFakeTimers();
    const fixture = await evaluationFixture();
    const scope = withOpenRouterKey(fixture);
    const subject = await loadScoredRun(scope, GRADED_RUN, STEP);
    const recovering = vi.fn()
      .mockResolvedValueOnce(new Response('rate limited', { status: 429 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: ANSWER }, finish_reason: 'stop' }] })));
    vi.stubGlobal('fetch', recovering);

    const recovered = runEvaluatorCheck(scope, judge, subject, null);
    await vi.runAllTimersAsync();
    expect(await recovered).toMatchObject({ passed: true, error: null });
    expect(recovering).toHaveBeenCalledTimes(2);

    const failing = vi.fn().mockImplementation(async () => new Response('unavailable', { status: 503 }));
    vi.stubGlobal('fetch', failing);
    const failed = runEvaluatorCheck(scope, judge, subject, null);
    await vi.runAllTimersAsync();
    expect(await failed).toMatchObject({ passed: null, error: expect.stringContaining('OpenRouter is having trouble') });
    expect(failing).toHaveBeenCalledTimes(2);
  });

  it('reports a check that cannot run as an error, not a failure', async () => {
    const fixture = await evaluationFixture();
    const outcome = await runEvaluatorCheck(fixture.scope(), judge, await loadScoredRun(fixture.scope(), GRADED_RUN, STEP), null);
    expect(outcome).toMatchObject({ passed: null, value: null, error: OPENROUTER_KEY_MISSING_MESSAGE });
  });
});
