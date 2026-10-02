import { describe, it, expect, afterEach, vi } from 'vitest';
import { InMemoryAgentTrajectoryRepository, buildAgentRun } from '@mediforce/platform-core/testing';
import { runEvaluatorCheck } from '../run-evaluator-check';
import { loadEvaluationSubject } from '../evaluation-subject';
import { createEvalCase } from '../../eval-cases';
import { evaluationFixture, GRADED_RUN, STEP } from '../../__tests__/fixture';

const judge = {
  kind: 'llm_judge' as const,
  model: 'anthropic/claude-haiku-4.5',
  rubric: 'Every AE carries a grade.',
  minConfidence: 0.8,
};

const ANSWER = '{"rationale": "Sepsis is graded 5, as the fatal outcome requires.", "passed": true, "confidence": 0.85}';

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
      agentRunId: 'errored', passed: false, value: 0, label: 'fail', confidence: null,
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
      agentRunId: GRADED_RUN, passed: true, value: 1, label: 'pass', confidence: 0.85,
      comment: 'Sepsis is graded 5, as the fatal outcome requires.', error: null,
    });
    const body = JSON.parse(String(fetchMock.mock.calls[0]![1]!.body)) as { model: string; temperature: number; messages: Array<{ content: string }> };
    expect(body).toMatchObject({ model: 'anthropic/claude-haiku-4.5', temperature: 0 });
    expect(body.messages[1]!.content).toContain('Sepsis was fatal, so it is grade 5.');
  });

  it('gives the judge the case notes but not whether the case is positive or negative', async () => {
    const fixture = await evaluationFixture();
    const fetchMock = vi.fn().mockImplementation(async () => new Response(JSON.stringify({
      choices: [{ message: { content: ANSWER }, finish_reason: 'stop' }],
    })));
    vi.stubGlobal('fetch', fetchMock);
    const scope = fixture.scope();
    Object.assign(scope, { workspaceSecrets: { getSecrets: async () => ({ OPENROUTER_API_KEY: 'sk-test' }) } });
    const { evalCase } = await createEvalCase({
      ...STEP,
      name: 'Grade 5 sepsis',
      input: { triggerPayload: { studyId: 'CDISCPILOT01' }, previousStepOutputs: {} },
      workspaceSeedCommit: null,
      expectation: 'negative',
      notes: 'Must not grade the fatal sepsis event below 5.',
      split: 'dev',
      containsProductionData: false,
      origin: 'user',
    }, scope);

    await runEvaluatorCheck(scope, judge, await loadEvaluationSubject(scope, GRADED_RUN, STEP), evalCase);

    const body = JSON.parse(String(fetchMock.mock.calls[0]![1]!.body)) as { messages: Array<{ content: string }> };
    const prompt = body.messages.map((message) => message.content).join('\n');
    expect(prompt).toContain('Must not grade the fatal sepsis event below 5.');
    expect(prompt).not.toMatch(/negative/i);
  });

  it('reports what a judge call spent even when its answer is unusable', async () => {
    const fixture = await evaluationFixture();
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => new Response(JSON.stringify({
      choices: [{ message: { content: 'I would rather not choose.' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 4000, completion_tokens: 500 },
    }))));
    const scope = fixture.scope();
    Object.assign(scope, { workspaceSecrets: { getSecrets: async () => ({ OPENROUTER_API_KEY: 'sk-test' }) } });
    const usages: unknown[] = [];

    const outcome = await runEvaluatorCheck(scope, judge, await loadEvaluationSubject(scope, GRADED_RUN, STEP), null, (usage) => usages.push(usage));

    expect(outcome).toMatchObject({ passed: null, value: null });
    expect(usages.length).toBeGreaterThan(0);
    expect(usages[0]).toEqual({ model: 'anthropic/claude-haiku-4.5', promptTokens: 4000, completionTokens: 500 });
  });

  it('reports a check that cannot run as an error, not a failure', async () => {
    const fixture = await evaluationFixture();
    const outcome = await runEvaluatorCheck(fixture.scope(), judge, await loadEvaluationSubject(fixture.scope(), GRADED_RUN, STEP), null);
    expect(outcome).toMatchObject({ passed: null, value: null, error: 'OPENROUTER_API_KEY not configured in workspace secrets' });
  });
});
