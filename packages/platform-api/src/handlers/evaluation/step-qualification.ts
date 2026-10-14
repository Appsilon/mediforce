import { randomUUID } from 'node:crypto';
import type { z } from 'zod';
import {
  DEFAULT_ACCEPTANCE_CRITERIA,
  inlineMcpServerNames,
  qualificationOutcome,
  qualificationSignatureMeaning,
  type AcceptanceCriteria,
  type ElectronicSignature,
  type EvalRun,
  type EvaluatedStep,
  type EvalRunEvaluator,
  type StepFingerprint,
  type StepQualification,
  type WorkflowStep,
} from '@mediforce/platform-core';
import type {
  GetStepQualificationInputSchema,
  GetStepQualificationOutput,
  GetWorkflowValidationInputSchema,
  GetWorkflowValidationOutput,
  SignStepQualificationInputSchema,
  SignStepQualificationOutput,
  StepValidation,
  WorkflowVersionValidation,
} from '../../contract/evaluation';
import type { CallerScope } from '../../repositories/index';
import { ConflictError, ForbiddenError, NotFoundError, PreconditionFailedError, ValidationError } from '../../errors';
import { inlineMcpReason, loadEvaluatedStep, stepRef } from './_lib/evaluated-step';
import { appendEvaluationAudit } from './_lib/audit';
import { buildEvalRunReport, rebuildEvalRunAcceptance } from './_lib/eval-run-report';
import { changedFingerprintComponents, computeStepFingerprint } from './_lib/step-fingerprint';

/** One of the Step's Evaluators with its newest version — `null` once archived. */
interface StepEvaluator {
  readonly id: string;
  readonly name: string;
  readonly latestVersion: number | null;
}

/**
 * The Step's own Evaluation rows — the same in every Definition version — each
 * read at most once, however many versions' validations ask for it.
 */
interface StepRows {
  readonly runs: () => Promise<readonly EvalRun[]>;
  readonly evaluators: () => Promise<readonly StepEvaluator[]>;
  readonly liveCaseIds: () => Promise<readonly string[]>;
  readonly criteria: () => Promise<AcceptanceCriteria>;
  readonly qualifications: () => Promise<readonly StepQualification[]>;
}

function once<Value>(read: () => Promise<Value>): () => Promise<Value> {
  let pending: Promise<Value> | undefined;
  return () => (pending ??= read());
}

function stepRows(scope: CallerScope, step: EvaluatedStep): StepRows {
  return {
    runs: once(() => scope.evaluation.listEvalRuns(step)),
    evaluators: once(async () => Promise.all((await scope.evaluation.listEvaluators(step)).map(async (evaluator) => ({
      id: evaluator.id,
      name: evaluator.name,
      latestVersion: evaluator.archived === true ? null : (await scope.evaluation.listEvaluatorVersions(evaluator.id)).at(-1)!.version,
    })))),
    liveCaseIds: once(async () => (await scope.evaluation.listCases(step)).filter((evalCase) => evalCase.archived === false).map((evalCase) => evalCase.id)),
    criteria: once(async () => (await scope.evaluation.listAcceptanceCriteria(step))[0]?.criteria ?? DEFAULT_ACCEPTANCE_CRITERIA),
    qualifications: once(() => scope.evaluation.listQualifications(step)),
  };
}

/** What happened to the Step's Evaluators since a qualification or an Eval Run froze them (D7). */
function evaluatorChanges(evaluators: readonly StepEvaluator[], frozen: readonly EvalRunEvaluator[], frozenBy: string): string[] {
  const cited = new Map(frozen.map((evaluator) => [evaluator.evaluatorId, evaluator.version]));
  const changes: string[] = [];
  for (const evaluator of evaluators) {
    const citedVersion = cited.get(evaluator.id);
    if (evaluator.latestVersion === null) {
      if (citedVersion !== undefined) changes.push(`'${evaluator.name}' archived`);
      continue;
    }
    if (citedVersion === undefined) changes.push(`'${evaluator.name}' added`);
    else if (evaluator.latestVersion !== citedVersion) changes.push(`'${evaluator.name}' now v${evaluator.latestVersion}, ${frozenBy} v${citedVersion}`);
  }
  return changes;
}

const FINISHED_RUN_STATUSES = new Set(['completed', 'budget_exceeded']);

/**
 * The step's validation in one Definition version: the newest finished Eval Run
 * of that version, judged on the criteria frozen into it — reset to
 * `not_verified` by any change to what that run rested on. Its verdict stands
 * once a person signed that run (`confirmed` or `overwritten`); until then the
 * step is `awaiting_approval`. A step that declares
 * MCP servers inline cannot be evaluated, so it stays `not_verified`. Its
 * Fingerprint is computed only when a run of that version finished.
 */
async function stepValidation(
  scope: CallerScope,
  rows: StepRows,
  workflowStep: WorkflowStep,
  definitionVersion: number,
  stepFingerprint: () => Promise<StepFingerprint>,
): Promise<StepValidation> {
  const inlineServers = inlineMcpServerNames(workflowStep);
  if (inlineServers.length > 0) {
    return { status: 'not_verified', evalRunId: null, reason: `The step ${inlineMcpReason(inlineServers)}.`, runInProgress: false };
  }
  const runs = await rows.runs();
  const runInProgress = runs.some((run) => run.status === 'running');
  const run = runs.find((candidate) => candidate.definitionVersion === definitionVersion && FINISHED_RUN_STATUSES.has(candidate.status));
  if (run === undefined) {
    return { status: 'not_verified', evalRunId: null, reason: `No Eval Run of version ${definitionVersion} has finished yet.`, runInProgress };
  }
  const notVerified = (reason: string): StepValidation => ({ status: 'not_verified', evalRunId: run.id, reason, runInProgress });
  const since = `since Eval Run ${run.id.slice(0, 8)}`;
  const fingerprint = await stepFingerprint();

  if (run.fingerprint === null || run.fingerprint.hash !== fingerprint.hash) {
    const changed = run.fingerprint === null ? [] : changedFingerprintComponents(run.fingerprint, fingerprint);
    return notVerified(`The step changed ${since}${changed.length === 0 ? '' : `: ${changed.join(', ')}`}.`);
  }
  const evaluatorsChanged = evaluatorChanges(await rows.evaluators(), run.evaluators, 'run with');
  if (evaluatorsChanged.length > 0) return notVerified(`Evaluators changed ${since}: ${evaluatorsChanged.join('; ')}.`);
  const live = await rows.liveCaseIds();
  const ran = new Set(run.caseIds);
  if (live.length !== ran.size || live.some((caseId) => ran.has(caseId) === false)) {
    return notVerified(`Eval Cases were added, edited or archived ${since}.`);
  }
  if (run.acceptanceCriteria === null || JSON.stringify(await rows.criteria()) !== JSON.stringify(run.acceptanceCriteria)) {
    return notVerified(run.acceptanceCriteria === null ? `Eval Run ${run.id.slice(0, 8)} had no Acceptance Criteria to judge.` : `Acceptance Criteria changed ${since}.`);
  }

  const acceptance = run.acceptance ?? await rebuildEvalRunAcceptance(scope, run);
  if (acceptance === null) return notVerified(`Eval Run ${run.id.slice(0, 8)} has not finished.`);
  const runLabel = `Eval Run ${run.id.slice(0, 8)}`;
  const verdict = acceptance.status === 'met' ? `${runLabel} met its Acceptance Criteria` : `${runLabel}: ${acceptance.reason}`;
  const signed = (await rows.qualifications()).find((qualification) => qualification.evalRunId === run.id);
  if (signed === undefined) {
    const runVerdict = acceptance.status === 'met' ? 'passed' : acceptance.status === 'missed' ? 'missed' : 'not_judged';
    const said = runVerdict === 'passed' ? 'its Acceptance Criteria were met' : acceptance.reason;
    return {
      status: 'awaiting_approval',
      evalRunId: run.id,
      reason: `${runLabel} ${runVerdict === 'not_judged' ? 'not judged' : runVerdict}: ${said}. Waiting for a person to confirm or overwrite the verdict.`,
      runVerdict,
      runInProgress,
    };
  }
  const outcome = qualificationOutcome(signed);
  const by = `${signed.signature.signerName}`;
  const reason = signed.decision === 'confirmed'
    ? `${verdict}; ${by} confirmed it.`
    : `${verdict}; ${by} overwrote it: ${signed.deviations[0]?.justification ?? 'no reason recorded'}.`;
  return { status: outcome, evalRunId: run.id, reason, runInProgress };
}

/**
 * The Step's qualification badge (ADR-0023 D11): `qualified` when some signed
 * qualification that passed — confirmed met, or overwritten from missed — binds the Step's Fingerprint as it is now — in the runnable
 * version, or the version asked about — `stale` when qualifications exist but
 * none binds it, `not_qualified` when none passed. Evaluators changed
 * since the qualification shown are flagged beside it (D7). Beside it, the
 * step's validation in that version (`stepValidation`).
 */
export async function getStepQualification(
  input: z.output<typeof GetStepQualificationInputSchema>,
  scope: CallerScope,
): Promise<GetStepQualificationOutput> {
  const step = stepRef(input);
  const { definition, step: workflowStep } = await loadEvaluatedStep(scope, step, 'read', input.definitionVersion);
  const fingerprint = await computeStepFingerprint(scope, definition, workflowStep);
  const rows = stepRows(scope, step);
  const history = [...await rows.qualifications()];
  const approvals = history.filter((qualification) => qualificationOutcome(qualification) === 'passed');
  const matching = approvals.find((qualification) => qualification.fingerprint.hash === fingerprint.hash);
  const shown = matching ?? approvals[0] ?? history[0];
  const validation = await stepValidation(scope, rows, workflowStep, definition.version, async () => fingerprint);
  if (shown === undefined || approvals.length === 0) {
    return { status: 'not_qualified', validation, qualification: shown ?? null, definitionVersion: definition.version, fingerprint, changed: [], evaluatorsChanged: [], history };
  }
  return {
    status: matching === undefined ? 'stale' : 'qualified',
    validation,
    qualification: shown,
    definitionVersion: definition.version,
    fingerprint,
    changed: changedFingerprintComponents(shown.fingerprint, fingerprint),
    evaluatorsChanged: evaluatorChanges(await rows.evaluators(), shown.evaluators, 'qualified with'),
    history,
  };
}

/**
 * Whether each live version of a workflow is verified: every agent step's
 * validation in that version (`stepValidation`), rolled up — `passed` when all
 * passed, `failed` when any failed, `awaiting_approval` when one waits for a
 * signature, else `not_verified`. Archived versions are
 * not evaluated, so they are left out.
 */
export async function getWorkflowValidation(
  input: z.output<typeof GetWorkflowValidationInputSchema>,
  scope: CallerScope,
): Promise<GetWorkflowValidationOutput> {
  const definitions = await scope.workflowDefinitions.listVersions(input.namespace, input.workflowName);
  if (definitions.length === 0) throw new NotFoundError(`Workflow '${input.workflowName}' not found`);
  const rowsByStep = new Map<string, StepRows>();
  const rowsOf = (stepId: string): StepRows => {
    if (rowsByStep.has(stepId) === false) rowsByStep.set(stepId, stepRows(scope, { namespace: input.namespace, workflowName: input.workflowName, stepId }));
    return rowsByStep.get(stepId)!;
  };

  const live = definitions.filter((definition) => definition.archived !== true).sort((left, right) => right.version - left.version);
  const versions = await Promise.all(live.map(async (definition): Promise<WorkflowVersionValidation> => {
    const steps = await Promise.all(definition.steps.filter((workflowStep) => workflowStep.executor === 'agent').map(async (workflowStep) => ({
      stepId: workflowStep.id,
      stepName: workflowStep.name,
      validation: await stepValidation(scope, rowsOf(workflowStep.id), workflowStep, definition.version, () => computeStepFingerprint(scope, definition, workflowStep)),
    })));
    const statuses = steps.map((entry) => entry.validation.status);
    const status = statuses.includes('failed')
      ? 'failed'
      : statuses.length > 0 && statuses.every((stepStatus) => stepStatus === 'passed')
        ? 'passed'
        : statuses.includes('awaiting_approval') ? 'awaiting_approval' : 'not_verified';
    return { definitionVersion: definition.version, status, steps };
  }));
  return { versions };
}

/**
 * A person signs a Step Qualification for a finished Eval Run (ADR-0023
 * D10) — not a cancelled one. It binds the run's Step Fingerprint and cites the run,
 * the Evaluator versions, the MCP eval policy and the
 * Acceptance Criteria frozen into it, with the verdict on them. The signer
 * confirms that verdict or overwrites it; overwriting records a deviation with
 * a written justification, and confirming takes none — either mismatch is
 * refused. A run is signed once. Only a person signs — an API key cannot, and the
 * Evaluation Assistant has no tool for it (D15).
 */
export async function signStepQualification(
  input: z.output<typeof SignStepQualificationInputSchema>,
  scope: CallerScope,
): Promise<SignStepQualificationOutput> {
  if (scope.caller.kind !== 'user') throw new ForbiddenError('A Step Qualification is signed by a person; an API key cannot sign one');
  const uid = scope.caller.uid;
  const run = await scope.evaluation.getEvalRun(input.evalRunId);
  if (run === null) throw new NotFoundError(`Eval Run '${input.evalRunId}' not found`);
  const step = stepRef(run);
  await loadEvaluatedStep(scope, step, 'edit', run.definitionVersion);

  const trials = await scope.evaluation.listTrials(run.id);
  const inFlight = trials.some((trial) => trial.status === 'pending' || trial.status === 'running' || trial.status === 'scoring');
  if (run.status === 'prepared' || run.status === 'running' || inFlight) {
    throw new ConflictError(`Eval Run '${run.id}' has not finished; sign once every trial is scored`);
  }
  if (run.status === 'cancelled') throw new ConflictError(`Eval Run '${run.id}' was cancelled; qualify a step on a run that finished`);
  const { fingerprint } = run;
  if (fingerprint === null) {
    throw new ValidationError('This Eval Run was prepared before Step Fingerprints; run the step again to qualify it');
  }
  if (run.acceptanceCriteria === null) {
    throw new ValidationError('No Acceptance Criteria were frozen into this Eval Run; set them and run the step again');
  }

  const report = await buildEvalRunReport(scope, run, trials);
  const verdict = report.criteriaVerdict;
  if (verdict === null) throw new ValidationError('No Acceptance Criteria were frozen into this Eval Run; set them and run the step again');
  if (input.decision === 'confirmed' && input.justification !== undefined) {
    throw new ValidationError('Confirming the verdict records no deviation; a justification is for overwriting it');
  }
  if (input.decision === 'overwritten' && input.justification === undefined) {
    throw new ValidationError('Overwriting the verdict records a deviation — give a written justification for it');
  }
  if ((await scope.evaluation.listQualifications(step)).some((existing) => existing.evalRunId === run.id)) {
    throw new ConflictError(`Eval Run '${run.id}' was already signed`);
  }
  const deviations = input.justification === undefined ? [] : [{ justification: input.justification }];
  const outcome = qualificationOutcome({ decision: input.decision, verdicts: [verdict] });

  const metadata = scope.system.userDirectory === null ? null : await scope.system.userDirectory.getUserMetadata(uid).catch(() => null);
  const qualification = await scope.evaluation.createQualification({
    ...step,
    id: randomUUID(),
    evalRunId: run.id,
    definitionVersion: run.definitionVersion,
    fingerprint,
    evaluators: run.evaluators,
    mcpPolicy: run.mcpPolicy,
    acceptanceCriteria: run.acceptanceCriteria,
    verdicts: [verdict],
    decision: input.decision,
    deviations,
    signature: {
      signerId: uid,
      signerName: metadata?.displayName ?? metadata?.email ?? uid,
      meaning: qualificationSignatureMeaning(input.decision, outcome),
      signedAt: new Date().toISOString(),
      reauthentication: 'session',
    },
  });
  await appendEvaluationAudit(scope, {
    action: 'step_qualification.signed',
    description: `Step Qualification signed for step '${step.stepId}' of '${step.workflowName}' by ${qualification.signature.signerName}`
      + (deviations.length === 0 ? ` (${input.decision})` : ` (${input.decision}, with a deviation)`),
    namespace: step.namespace,
    entityType: 'step_qualification',
    entityId: qualification.id,
    inputSnapshot: { evalRunId: run.id, justification: input.justification ?? null },
    outputSnapshot: {
      fingerprint: qualification.fingerprint.hash,
      verdict: verdict.status,
      decision: input.decision,
      outcome,
      signature: qualification.signature,
    },
    basis: 'A person signed the Step Qualification (ADR-0023 D10, 21 CFR 11.50)',
  });
  return { qualification };
}
