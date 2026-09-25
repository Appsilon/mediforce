import { randomUUID } from 'node:crypto';
import { describe, it, expect, beforeEach } from 'vitest';
import type { CallerScope } from '../../../../repositories/index';
import { archiveEvalCase, createEvalCase } from '../../eval-cases';
import { exampleCasesProblem } from '../example-cases';
import { evaluationFixture, STEP, type EvaluationFixture } from '../../__tests__/fixture';

describe('exampleCasesProblem (ADR-0023 D12)', () => {
  let fixture: EvaluationFixture;
  let scope: CallerScope;

  async function addCase(name: string, split: 'dev' | 'holdout'): Promise<string> {
    const { evalCase } = await createEvalCase({
      ...STEP,
      name,
      input: { triggerPayload: { studyId: 'CDISCPILOT01' }, previousStepOutputs: {} },
      workspaceSeedCommit: null,
      expectation: 'positive',
      notes: null,
      split,
      containsProductionData: false,
      origin: 'user',
    }, scope);
    return evalCase.id;
  }

  const example = (caseId?: string) => ({ input: 'Sepsis, fatal', output: '{"grade": 5}', ...(caseId === undefined ? {} : { caseId }) });

  beforeEach(async () => {
    fixture = await evaluationFixture();
    scope = fixture.scope();
  });

  it('accepts examples written by hand and examples from the step\'s dev cases', async () => {
    const devCase = await addCase('Grade 5 sepsis', 'dev');
    expect(await exampleCasesProblem(scope, STEP, [])).toBeNull();
    expect(await exampleCasesProblem(scope, STEP, [example(), example(devCase)])).toBeNull();
  });

  it('refuses a holdout case', async () => {
    const holdoutCase = await addCase('Grade 4 neutropenia', 'holdout');
    expect(await exampleCasesProblem(scope, STEP, [example(holdoutCase)]))
      .toMatch(/holdout cases are never offered as examples/);
  });

  it('refuses an archived case, an unknown case, and a case of another step', async () => {
    const archived = await addCase('Grade 3 rash', 'dev');
    await archiveEvalCase({ caseId: archived, archived: true }, scope);
    expect(await exampleCasesProblem(scope, STEP, [example(archived)])).toMatch(/archived/);

    const unknown = randomUUID();
    expect(await exampleCasesProblem(scope, STEP, [example(unknown)])).toMatch(new RegExp(`${unknown}.*not an Eval Case of step 'grade-aes'`));

    const otherStepCase = await addCase('Grade 2 nausea', 'dev');
    expect(await exampleCasesProblem(scope, { ...STEP, stepId: 'extract-aes' }, [example(otherStepCase)]))
      .toMatch(/not an Eval Case of step 'extract-aes'/);
  });
});
