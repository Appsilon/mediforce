import { beforeEach, describe, expect, it } from 'vitest';
import type { CallerScope } from '../../../../repositories/index';
import { loadEvaluatedStep } from '../evaluated-step';
import { stepPatchProblem } from '../step-patch-problem';
import { evaluationFixture, STEP, type EvaluationFixture } from '../../__tests__/fixture';

describe('stepPatchProblem (ADR-0023 D5, D12)', () => {
  let fixture: EvaluationFixture;
  let scope: CallerScope;

  beforeEach(async () => {
    fixture = await evaluationFixture();
    scope = fixture.scope();
  });

  async function problemOf(patch: Parameters<typeof stepPatchProblem>[4]): Promise<string | null> {
    const { definition, step } = await loadEvaluatedStep(scope, STEP, 'read');
    return stepPatchProblem(scope, STEP, definition, step, patch);
  }

  it('accepts a patch that changes the step', async () => {
    expect(await problemOf({ prompt: 'Grade adverse events by CTCAE v5.' })).toBeNull();
  });

  it('refuses a patch that changes nothing', async () => {
    expect(await problemOf({})).toMatch(/changes nothing/);
  });

  it('refuses a skill commit when the workflow has no external skills repository', async () => {
    expect(await problemOf({ skillCommit: 'abcdef1' })).toMatch(/external skills repository/);
  });

  it('refuses examples that cite a case that does not exist', async () => {
    const problem = await problemOf({ examples: [{ input: 'Sepsis', output: '{"grade":5}', caseId: '00000000-0000-4000-8000-000000000000' }] });
    expect(problem).not.toBeNull();
  });
});
