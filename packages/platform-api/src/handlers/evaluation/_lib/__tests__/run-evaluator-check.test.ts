import { describe, it, expect, afterEach, vi } from 'vitest';
import { InMemoryAgentTrajectoryRepository, buildAgentRun } from '@mediforce/platform-core/testing';
import { runEvaluatorCheck } from '../run-evaluator-check';
import { loadEvaluationSubject } from '../evaluation-subject';
import { createEvalCase } from '../../eval-cases';
import { CreateEvalCaseInputSchema } from '../../../../contract/evaluation';
import { evaluationFixture, GRADED_RUN, STEP, type EvaluationFixture } from '../../__tests__/fixture';

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
  });

  it('fails every check on a run that produced no result, without running it', async () => {
    const fixture = await evaluationFixture();
    await fixture.agentRunRepo.create(buildAgentRun({
      id: 'errored', processInstanceId: 'run-graded', stepId: 'grade-aes', status: 'error', envelope: null,
    }));
    const subject = await loadEvaluationSubject(fixture.scope(), 'errored', STEP);
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

    const outcome = await runEvaluatorCheck(scope, judge, await loadEvaluationSubject(scope, GRADED_RUN, STEP), null);

    expect(outcome).toEqual({
      agentRunId: GRADED_RUN, passed: true, value: 1, label: 'pass', confidence: 0.85, agreement: null,
      comment: 'Sepsis is graded 5, as the fatal outcome requires.', error: null,
    });
    const body = JSON.parse(String(fetchMock.mock.calls[0]![1]!.body)) as { model: string; temperature: number; messages: Array<{ content: string }> };
    expect(body).toMatchObject({ model: 'anthropic/claude-haiku-4.5', temperature: 0 });
    expect(body.messages[1]!.content).toContain('Sepsis was fatal, so it is grade 5.');
  });

  it('tells an llm_judge neither a case\'s expected output nor whether the case is negative', async () => {
    const fixture = await evaluationFixture();
    const fetchMock = answeringOpenRouter(ANSWER);
    const scope = withOpenRouterKey(fixture);
    const evalCase = await caseExpecting(fixture, { expectedOutput: { marker: 'EXPECTED-OUTPUT-MARKER' }, expectation: 'negative' });

    await runEvaluatorCheck(scope, judge, await loadEvaluationSubject(scope, GRADED_RUN, STEP), evalCase);

    const body = JSON.parse(String(fetchMock.mock.calls[0]![1]!.body)) as { messages: Array<{ content: string }> };
    const prompt = body.messages.map((message) => message.content).join('\n');
    expect(prompt).not.toContain('EXPECTED-OUTPUT-MARKER');
    expect(prompt).not.toMatch(/negative/i);
  });

  describe('expected_output, exact', () => {
    it('passes a positive case only on an output that matches its expected output exactly', async () => {
      const fixture = await evaluationFixture();
      const subject = await loadEvaluationSubject(fixture.scope(), GRADED_RUN, STEP);

      const matching = await caseExpecting(fixture, { expectedOutput: { findings: [{ grade: 5, term: 'Sepsis' }] } });
      expect(await runEvaluatorCheck(fixture.scope(), expected, subject, matching)).toMatchObject({ passed: true, value: 1, agreement: null });

      const differing = await caseExpecting(fixture, { expectedOutput: { findings: [{ term: 'Sepsis', grade: 4 }] } });
      expect(await runEvaluatorCheck(fixture.scope(), expected, subject, differing)).toMatchObject({
        passed: false, comment: expect.stringContaining('findings.0.grade: expected 4, got 5'),
      });
    });

    it('passes a negative case only on an output that differs from its expected output', async () => {
      const fixture = await evaluationFixture();
      const subject = await loadEvaluationSubject(fixture.scope(), GRADED_RUN, STEP);

      const avoided = await caseExpecting(fixture, { expectedOutput: { findings: [{ term: 'Sepsis', grade: 5 }] }, expectation: 'negative' });
      expect(await runEvaluatorCheck(fixture.scope(), expected, subject, avoided)).toMatchObject({ passed: false, comment: expect.stringContaining('must not get') });

      const other = await caseExpecting(fixture, { expectedOutput: { findings: [{ term: 'Sepsis', grade: 1 }] }, expectation: 'negative' });
      expect(await runEvaluatorCheck(fixture.scope(), expected, subject, other)).toMatchObject({ passed: true });
    });

    it('is an error, not a failure, on a case without an expected output', async () => {
      const fixture = await evaluationFixture();
      const subject = await loadEvaluationSubject(fixture.scope(), GRADED_RUN, STEP);
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

      const outcome = await runEvaluatorCheck(scope, expected, await loadEvaluationSubject(scope, GRADED_RUN, STEP), evalCase, (call) => calls.push(call));

      expect(outcome).toMatchObject({ passed: true, value: 1, agreement: 0.9, comment: expect.stringContaining('Same term and grade.') });
      expect(calls).toHaveLength(1);
      const body = JSON.parse(String(fetchMock.mock.calls[0]![1]!.body)) as { model: string; messages: Array<{ content: string }> };
      expect(body.model).toBe('anthropic/claude-haiku-4.5');
      expect(body.messages[0]!.content).toContain('Wording is never decisive.');
      expect(body.messages[1]!.content).toContain('The term wording is trivial; the grade is not.');
      expect(body.messages[1]!.content).toContain('Sepsis (fatal)');
    });

    it('fails a positive case below minAgreement, and a negative case at it', async () => {
      const fixture = await evaluationFixture();
      const scope = withOpenRouterKey(fixture);
      const subject = await loadEvaluationSubject(scope, GRADED_RUN, STEP);
      const label = { expectedOutput: { findings: [{ term: 'Sepsis', grade: 5 }] }, comparison: 'agreement' };

      answeringOpenRouter('{"rationale": "The grade differs.", "agreement": 0.3}');
      expect(await runEvaluatorCheck(scope, expected, subject, await caseExpecting(fixture, label))).toMatchObject({ passed: false, agreement: 0.3 });

      answeringOpenRouter('{"rationale": "They agree.", "agreement": 0.95}');
      expect(await runEvaluatorCheck(scope, expected, subject, await caseExpecting(fixture, { ...label, expectation: 'negative' }))).toMatchObject({ passed: false, agreement: 0.95 });
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

    const outcome = await runEvaluatorCheck(scope, judge, await loadEvaluationSubject(scope, GRADED_RUN, STEP), null, (call) => calls.push(call));

    expect(outcome).toMatchObject({ passed: null, value: null });
    expect(calls.length).toBeGreaterThan(0);
    expect(calls[0]).toEqual({
      model: 'anthropic/claude-haiku-4.5', promptTokens: 4000, completionTokens: 500, durationMs: expect.any(Number), response: 'I would rather not choose.',
    });
  });

  it('reports a check that cannot run as an error, not a failure', async () => {
    const fixture = await evaluationFixture();
    const outcome = await runEvaluatorCheck(fixture.scope(), judge, await loadEvaluationSubject(fixture.scope(), GRADED_RUN, STEP), null);
    expect(outcome).toMatchObject({ passed: null, value: null, error: 'OPENROUTER_API_KEY not configured in workspace secrets' });
  });
});
