import { describe, it, expect, beforeEach } from 'vitest';
import { ConflictError, NotFoundError } from '../../../errors';
import { userCaller } from '../../../repositories/__tests__/create-test-scope';
import { createEvaluator, addEvaluatorVersion, archiveEvaluator, listEvaluators } from '../evaluators';
import { evaluationFixture, STEP, type EvaluationFixture } from './fixture';

const findingsSchema = { kind: 'schema' as const, schema: { required: ['findings'] } };

describe('Evaluators', () => {
  let fixture: EvaluationFixture;
  beforeEach(async () => { fixture = await evaluationFixture(); });

  it('trusts a schema check at once and holds a code check until approved', async () => {
    const { evaluator: schema } = await createEvaluator(
      { ...STEP, name: 'findings-present', rule: 'The result lists findings.', severity: 'critical', check: findingsSchema, origin: 'user' },
      fixture.scope(),
    );
    const { evaluator: code } = await createEvaluator(
      { ...STEP, name: 'grade-5-flagged', rule: 'A fatal AE is graded 5.', severity: 'critical', check: { kind: 'code', runtime: 'python', source: 'print(1)' }, origin: 'assistant' },
      fixture.scope(),
    );

    expect(schema.trust).toEqual({ trusted: true });
    expect(code.trust).toEqual({ trusted: false, reason: 'source not approved' });
    expect(code.latest).toMatchObject({ version: 1, origin: 'assistant', sourceApproval: null });
  });

  it('refuses a second Evaluator of the same name on the step', async () => {
    const input = { ...STEP, name: 'findings-present', rule: 'r', severity: 'major' as const, check: findingsSchema, origin: 'user' as const };
    await createEvaluator(input, fixture.scope());
    await expect(createEvaluator(input, fixture.scope())).rejects.toBeInstanceOf(ConflictError);
  });

  it('makes a change a new version that carries over what it does not change', async () => {
    const { evaluator } = await createEvaluator(
      { ...STEP, name: 'findings-present', rule: 'The result lists findings.', severity: 'critical', check: findingsSchema, origin: 'user' },
      fixture.scope(),
    );
    const { evaluator: changed } = await addEvaluatorVersion(
      { evaluatorId: evaluator.id, severity: 'minor', origin: 'user' },
      fixture.scope(),
    );

    expect(changed.versions.map((version) => [version.version, version.severity])).toEqual([[1, 'critical'], [2, 'minor']]);
    expect(changed.latest).toMatchObject({ rule: 'The result lists findings.', check: findingsSchema });
  });

  it('leaves archived Evaluators out of the list unless asked', async () => {
    const { evaluator } = await createEvaluator(
      { ...STEP, name: 'findings-present', rule: 'r', severity: 'major', check: findingsSchema, origin: 'user' },
      fixture.scope(),
    );
    await archiveEvaluator({ evaluatorId: evaluator.id, archived: true }, fixture.scope());

    expect((await listEvaluators(STEP, fixture.scope())).evaluators).toEqual([]);
    expect((await listEvaluators({ ...STEP, includeArchived: true }, fixture.scope())).evaluators).toHaveLength(1);
  });

  it('needs the workspace to write', async () => {
    await expect(createEvaluator(
      { ...STEP, name: 'x', rule: 'r', severity: 'major', check: findingsSchema, origin: 'user' },
      fixture.scope(userCaller('outsider', ['pharma-b'])),
    )).rejects.toBeInstanceOf(NotFoundError);
  });
});
