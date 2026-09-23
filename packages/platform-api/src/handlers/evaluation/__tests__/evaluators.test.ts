import { describe, it, expect, beforeEach } from 'vitest';
import { ConflictError, NotFoundError, ValidationError } from '../../../errors';
import { userCaller } from '../../../repositories/__tests__/create-test-scope';
import { createEvaluator, addEvaluatorVersion, archiveEvaluator, listEvaluators } from '../evaluators';
import { getEvaluationBrief, setEvaluationBrief } from '../briefs';
import { previewEvaluator } from '../preview-evaluator';
import { evaluationFixture, GRADED_RUN, NAMESPACE, STEP, UNGRADED_RUN, type EvaluationFixture } from './fixture';

const findingsSchema = { kind: 'schema' as const, schema: { required: ['findings'] } };

describe('Evaluation Briefs', () => {
  let fixture: EvaluationFixture;
  beforeEach(async () => { fixture = await evaluationFixture(); });

  it('versions every write and serves the newest as current', async () => {
    await setEvaluationBrief({ ...STEP, text: 'Grades AEs for the DSMB.', origin: 'user' }, fixture.scope());
    await setEvaluationBrief({ ...STEP, text: 'A missed grade 5 is critical.', origin: 'assistant' }, fixture.scope());

    const { brief, versions } = await getEvaluationBrief(STEP, fixture.scope());
    expect(brief).toMatchObject({ version: 2, text: 'A missed grade 5 is critical.', origin: 'assistant', createdBy: 'author-1' });
    expect(versions.map((version) => version.version)).toEqual([2, 1]);
    expect(await fixture.auditRepo.getByEntity('evaluation_brief', 'ae-grading/grade-aes')).toHaveLength(2);
  });

  it('only evaluates agent steps', async () => {
    await expect(getEvaluationBrief({ ...STEP, stepId: 'extract-aes' }, fixture.scope()))
      .rejects.toBeInstanceOf(ValidationError);
  });

  it('reads a workflow in another workspace as missing', async () => {
    await expect(getEvaluationBrief(STEP, fixture.scope(userCaller('outsider', ['pharma-b']))))
      .rejects.toBeInstanceOf(NotFoundError);
  });
});

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

describe('previewEvaluator', () => {
  it('runs a draft check against the step\'s production outputs and writes nothing', async () => {
    const fixture = await evaluationFixture();
    const { results } = await previewEvaluator({ ...STEP, check: findingsSchema, limit: 5 }, fixture.scope());

    expect(results).toEqual(expect.arrayContaining([
      { agentRunId: GRADED_RUN, passed: true, value: 1, label: 'pass', comment: null, error: null },
      { agentRunId: UNGRADED_RUN, passed: false, value: 0, label: 'fail', comment: 'missing required keys: findings', error: null },
    ]));
    expect(await fixture.scoreRepo.list({ limit: 10 })).toEqual([]);
    expect(await fixture.evaluationRepo.listEvaluators(STEP)).toEqual([]);
  });

  it('refuses an Agent Run of another step', async () => {
    const fixture = await evaluationFixture();
    await expect(previewEvaluator(
      { ...STEP, stepId: 'grade-aes', workflowName: 'ae-grading', namespace: NAMESPACE, check: findingsSchema, agentRunIds: ['no-such-run'], limit: 5 },
      fixture.scope(),
    )).rejects.toBeInstanceOf(NotFoundError);
  });
});
