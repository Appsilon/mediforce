import { describe, it, expect, beforeEach } from 'vitest';
import { createRedTeamEvalCases } from '../red-team-cases';
import { listEvalCases } from '../eval-cases';
import { evaluationFixture, GRADED_RUN, STEP, type EvaluationFixture } from './fixture';

const TARGET = { part: 'previousStepOutputs' as const, path: ['extract-aes', 'events', '0', 'term'] };
const REQUEST = { ...STEP, baseAgentRunId: GRADED_RUN, split: 'dev', origin: 'user' } as const;

describe('createRedTeamEvalCases', () => {
  let fixture: EvaluationFixture;
  beforeEach(async () => { fixture = await evaluationFixture(); });

  it('injects each built-in instruction, with a canary of its own, into the targeted text', async () => {
    const { cases } = await createRedTeamEvalCases({ ...REQUEST, suite: 'prompt_injection', target: TARGET }, fixture.scope());

    expect(cases).toHaveLength(3);
    const canaries = cases.map((evalCase) => evalCase.perturbation?.canary);
    expect(new Set(canaries).size).toBe(3);
    for (const evalCase of cases) {
      const term = (evalCase.input.previousStepOutputs['extract-aes'] as { events: { term: string }[] }).events[0]!.term;
      expect(term.startsWith('Sepsis')).toBe(true);
      expect(term).toContain(evalCase.perturbation!.canary);
      expect(evalCase).toMatchObject({
        source: 'synthesized', sourceAgentRunId: GRADED_RUN, expectation: 'positive', containsProductionData: true,
        perturbation: { kind: 'injected_instruction' },
      });
    }
    expect((await listEvalCases(STEP, fixture.scope())).cases).toHaveLength(3);
  });

  it('rewrites text and objects without changing what they say', async () => {
    const text = await createRedTeamEvalCases({ ...REQUEST, suite: 'robustness', target: TARGET }, fixture.scope());
    expect(text.cases.map((evalCase) => evalCase.perturbation?.kind)).toEqual(['metamorphic']);
    const terms = text.cases.map((evalCase) => (evalCase.input.previousStepOutputs['extract-aes'] as { events: { term: string }[] }).events[0]!.term);
    expect(terms).toEqual(['\n\nSepsis\n\n']);

    const object = await createRedTeamEvalCases({
      ...REQUEST, suite: 'robustness', target: { part: 'previousStepOutputs', path: ['extract-aes', 'events', '0'] },
    }, fixture.scope());
    expect(object.cases).toHaveLength(1);
    const [event] = (object.cases[0]!.input.previousStepOutputs['extract-aes'] as { events: object[] }).events;
    expect(Object.keys(event!)).toEqual(['outcome', 'term']);
  });

  it('refuses a target that is missing or cannot take the suite\'s change, creating nothing', async () => {
    const scope = fixture.scope();
    await expect(createRedTeamEvalCases({ ...REQUEST, suite: 'prompt_injection', target: { part: 'triggerPayload', path: ['nothing'] } }, scope))
      .rejects.toThrow("'triggerPayload.nothing' is not in the input");
    await expect(createRedTeamEvalCases({ ...REQUEST, suite: 'prompt_injection', target: { part: 'previousStepOutputs', path: ['extract-aes', 'events'] } }, scope))
      .rejects.toThrow('is not text');
    await expect(createRedTeamEvalCases({ ...REQUEST, suite: 'robustness', target: { part: 'previousStepOutputs', path: ['extract-aes', 'events'] } }, scope))
      .rejects.toThrow('neither text nor an object');
    expect((await listEvalCases(STEP, scope)).cases).toEqual([]);
  });
});
