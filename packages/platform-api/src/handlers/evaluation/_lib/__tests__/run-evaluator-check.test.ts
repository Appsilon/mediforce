import { describe, it, expect, afterEach, vi } from 'vitest';
import { buildAgentRun } from '@mediforce/platform-core/testing';
import { runEvaluatorCheck } from '../run-evaluator-check';
import { loadEvaluationSubject } from '../evaluation-subject';
import { evaluationFixture, GRADED_RUN, STEP } from '../../__tests__/fixture';

const judge = {
  kind: 'llm_judge' as const,
  model: 'anthropic/claude-haiku-4.5',
  rubric: 'Every AE carries a grade.',
  choices: [{ label: 'graded', value: 1 }, { label: 'ungraded', value: 0 }],
};

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
      agentRunId: 'errored', passed: false, value: 0, label: 'fail',
      comment: 'The Agent Run produced no result (status: error)', error: null,
    });
  });

  it('asks the judge through the platform\'s OpenRouter seam and maps its choice', async () => {
    const fixture = await evaluationFixture();
    const fetchMock = vi.fn().mockImplementation(async () => new Response(JSON.stringify({
      choices: [{ message: { content: '{"reasoning": "Sepsis is graded 5.", "choice": "graded"}' }, finish_reason: 'stop' }],
    })));
    vi.stubGlobal('fetch', fetchMock);
    const scope = fixture.scope();
    Object.assign(scope, { workspaceSecrets: { getSecrets: async () => ({ OPENROUTER_API_KEY: 'sk-test' }) } });

    const outcome = await runEvaluatorCheck(scope, judge, await loadEvaluationSubject(scope, GRADED_RUN, STEP), null);

    expect(outcome).toMatchObject({ passed: true, value: 1, label: 'graded', comment: 'Sepsis is graded 5.', error: null });
    const body = JSON.parse(String(fetchMock.mock.calls[0]![1]!.body)) as { model: string; temperature: number };
    expect(body).toMatchObject({ model: 'anthropic/claude-haiku-4.5', temperature: 0 });
  });

  it('reports a check that cannot run as an error, not a failure', async () => {
    const fixture = await evaluationFixture();
    const outcome = await runEvaluatorCheck(fixture.scope(), judge, await loadEvaluationSubject(fixture.scope(), GRADED_RUN, STEP), null);
    expect(outcome).toMatchObject({ passed: null, value: null, error: 'OPENROUTER_API_KEY not configured in workspace secrets' });
  });
});
