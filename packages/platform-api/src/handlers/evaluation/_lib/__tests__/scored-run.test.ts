import { describe, it, expect } from 'vitest';
import { NotFoundError, ValidationError } from '../../../../errors';
import { userCaller } from '../../../../repositories/__tests__/create-test-scope';
import { loadScoredRun } from '../scored-run';
import { evaluationFixture, GRADED_RUN, STEP } from '../../__tests__/fixture';

describe('loadScoredRun', () => {
  it('pairs the Agent Run with the input its execution was given', async () => {
    const fixture = await evaluationFixture();
    const subject = await loadScoredRun(fixture.scope(), GRADED_RUN, STEP);
    expect(subject.instance.id).toBe('run-graded');
    expect(subject.stepInput).toMatchObject({ steps: { 'extract-aes': { events: [{ term: 'Sepsis', outcome: 'fatal' }] } } });
    expect(subject.trajectory).toEqual([]);
  });

  it('refuses a run of another step', async () => {
    const fixture = await evaluationFixture();
    await expect(loadScoredRun(fixture.scope(), GRADED_RUN, { ...STEP, stepId: 'extract-aes' }))
      .rejects.toBeInstanceOf(ValidationError);
  });

  it('reads a run in another workspace as missing — Agent Runs themselves are not gated', async () => {
    const fixture = await evaluationFixture();
    await expect(loadScoredRun(fixture.scope(userCaller('outsider', ['pharma-b'])), GRADED_RUN))
      .rejects.toBeInstanceOf(NotFoundError);
  });
});
