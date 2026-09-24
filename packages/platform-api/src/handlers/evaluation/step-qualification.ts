import { randomUUID } from 'node:crypto';
import type { z } from 'zod';
import {
  qualificationSignatureMeaning,
  type ElectronicSignature,
  type EvalRun,
  type EvaluatedStep,
  type StepQualification,
} from '@mediforce/platform-core';
import type {
  GetStepQualificationInputSchema,
  GetStepQualificationOutput,
  SignStepQualificationInputSchema,
  SignStepQualificationOutput,
} from '../../contract/evaluation';
import type { CallerScope } from '../../repositories/index';
import { ConflictError, ForbiddenError, NotFoundError, PreconditionFailedError, ValidationError } from '../../errors';
import { loadEvaluatedStep, stepRef } from './_lib/evaluated-step';
import { appendEvaluationAudit } from './_lib/audit';
import { buildEvalRunReport } from './_lib/eval-run-report';
import { checkPassword } from '../users/_lib/check-password';
import { changedFingerprintComponents, computeStepFingerprint } from './_lib/step-fingerprint';

/** What happened to the Step's Evaluators since a qualification cited them (D7): a flag, never staleness. */
async function evaluatorChanges(scope: CallerScope, step: EvaluatedStep, qualification: StepQualification): Promise<string[]> {
  const cited = new Map(qualification.evaluators.map((evaluator) => [evaluator.evaluatorId, evaluator.version]));
  const changes: string[] = [];
  for (const evaluator of await scope.evaluation.listEvaluators(step)) {
    const citedVersion = cited.get(evaluator.id);
    if (evaluator.archived === true) {
      if (citedVersion !== undefined) changes.push(`'${evaluator.name}' archived`);
      continue;
    }
    const versions = await scope.evaluation.listEvaluatorVersions(evaluator.id);
    const latest = versions[versions.length - 1]!.version;
    if (citedVersion === undefined) changes.push(`'${evaluator.name}' added`);
    else if (latest !== citedVersion) changes.push(`'${evaluator.name}' now v${latest}, qualified with v${citedVersion}`);
  }
  return changes;
}

/**
 * The Step's qualification badge (ADR-0023 D11): `qualified` when some signed
 * qualification binds the Step's Fingerprint as it is now — in the runnable
 * version, or the version asked about — `stale` when qualifications exist but
 * none binds it, `not_qualified` when none was ever signed. Evaluators changed
 * since the qualification shown are flagged beside it (D7).
 */
export async function getStepQualification(
  input: z.output<typeof GetStepQualificationInputSchema>,
  scope: CallerScope,
): Promise<GetStepQualificationOutput> {
  const step = stepRef(input);
  const { definition, step: workflowStep } = await loadEvaluatedStep(scope, step, 'read', input.definitionVersion);
  const fingerprint = await computeStepFingerprint(scope, definition, workflowStep);
  const history = await scope.evaluation.listQualifications(step);
  const matching = history.find((qualification) => qualification.fingerprint.hash === fingerprint.hash);
  const shown = matching ?? history[0];
  if (shown === undefined) {
    return { status: 'not_qualified', qualification: null, definitionVersion: definition.version, fingerprint, changed: [], evaluatorsChanged: [], history };
  }
  return {
    status: matching === undefined ? 'stale' : 'qualified',
    qualification: shown,
    definitionVersion: definition.version,
    fingerprint,
    changed: changedFingerprintComponents(shown.fingerprint, fingerprint),
    evaluatorsChanged: await evaluatorChanges(scope, step, shown),
    history,
  };
}

/**
 * The signer proves who they are again at signing (21 CFR 11.200): with their
 * password where password sign-in is enabled, or, on a deployment without it,
 * with the session they sign from — recorded either way. A wrong password is
 * audited against the run, so failed attempts can be detected (11.300(d)).
 */
async function reauthenticate(scope: CallerScope, uid: string, password: string | undefined, run: EvalRun): Promise<ElectronicSignature['reauthentication']> {
  if (scope.system.passwordAuthEnabled !== true) return 'session';
  const check = await checkPassword(scope, uid, password);
  if (check === 'no_password') {
    throw new PreconditionFailedError('Set a password for your account to sign: signing asks for it again');
  }
  if (check === 'not_given') throw new ValidationError('Enter your password to sign');
  if (check === 'incorrect') {
    await appendEvaluationAudit(scope, {
      action: 'step_qualification.signature_refused',
      description: `Step Qualification signing refused for step '${run.stepId}' of '${run.workflowName}': password incorrect`,
      namespace: run.namespace,
      entityType: 'eval_run',
      entityId: run.id,
      inputSnapshot: {},
      basis: 'A signer failed to re-authenticate (21 CFR 11.300(d))',
    });
    throw new ForbiddenError('Password is incorrect');
  }
  return 'password';
}

/**
 * A person signs a Step Qualification for one variant of a finished Eval Run
 * (ADR-0023 D10) — not a cancelled one. It binds that variant's Step Fingerprint and cites the run,
 * the Brief version, the Evaluator versions, the MCP eval policy and the
 * Acceptance Criteria frozen into it, with the verdict on each criterion.
 * Signing despite a criterion missed or not judged records a deviation with a
 * written justification; one without it is refused, as is a justification for
 * a criterion that was met. Only a person signs — an API key cannot, and the
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
  await loadEvaluatedStep(scope, step, 'edit');

  const trials = await scope.evaluation.listTrials(run.id);
  const inFlight = trials.some((trial) => trial.status === 'pending' || trial.status === 'running' || trial.status === 'scoring');
  if (run.status === 'prepared' || run.status === 'running' || inFlight) {
    throw new ConflictError(`Eval Run '${run.id}' has not finished; sign once every trial is scored`);
  }
  if (run.status === 'cancelled') throw new ConflictError(`Eval Run '${run.id}' was cancelled; qualify a step on a run that finished`);
  const variant = run.variants.find((candidate) => candidate.id === input.variantId);
  if (variant === undefined) throw new NotFoundError(`Eval Run '${run.id}' has no variant '${input.variantId}'`);
  if (variant.fingerprint === null) {
    throw new ValidationError('This Eval Run was prepared before Step Fingerprints; run the step again to qualify it');
  }
  if (run.acceptanceCriteria === null) {
    throw new ValidationError('No Acceptance Criteria were frozen into this Eval Run; set them and run the step again');
  }
  if (run.briefVersion === null) {
    throw new ValidationError('The step had no Evaluation Brief when this Eval Run was prepared; write one and run the step again');
  }

  const report = await buildEvalRunReport(scope, run, trials);
  const verdicts = report.variants.find((candidate) => candidate.id === variant.id)!.criteria;
  const justified = new Set<string>();
  for (const deviation of input.deviations) {
    if (justified.has(deviation.severity)) throw new ValidationError(`Give one justification for the ${deviation.severity} criterion`);
    justified.add(deviation.severity);
    const verdict = verdicts.find((candidate) => candidate.severity === deviation.severity);
    if (verdict === undefined || verdict.status === 'met') {
      throw new ValidationError(`The ${deviation.severity} criterion ${verdict === undefined ? 'was not set' : 'was met'}; there is no deviation to justify`);
    }
  }
  for (const verdict of verdicts) {
    if (verdict.status === 'met' || justified.has(verdict.severity)) continue;
    throw new ValidationError(
      `The ${verdict.severity} criterion was ${verdict.status === 'missed' ? 'missed' : 'not judged'} (${verdict.reason}); `
      + 'signing anyway records a deviation — give a written justification for it',
    );
  }

  const reauthentication = await reauthenticate(scope, uid, input.password, run);
  const metadata = scope.system.userDirectory === null ? null : await scope.system.userDirectory.getUserMetadata(uid).catch(() => null);
  const qualification = await scope.evaluation.createQualification({
    ...step,
    id: randomUUID(),
    evalRunId: run.id,
    definitionVersion: run.definitionVersion,
    variantId: variant.id,
    variantLabel: variant.label,
    patch: variant.patch,
    fingerprint: variant.fingerprint,
    briefVersion: run.briefVersion,
    evaluators: run.evaluators,
    mcpPolicy: run.mcpPolicy,
    acceptanceCriteria: run.acceptanceCriteria,
    verdicts,
    deviations: input.deviations,
    signature: {
      signerId: uid,
      signerName: metadata?.displayName ?? metadata?.email ?? uid,
      meaning: qualificationSignatureMeaning(run.briefVersion),
      signedAt: new Date().toISOString(),
      reauthentication,
    },
  });
  await appendEvaluationAudit(scope, {
    action: 'step_qualification.signed',
    description: `Step Qualification signed for step '${step.stepId}' of '${step.workflowName}' by ${qualification.signature.signerName}`
      + (qualification.deviations.length === 0 ? '' : ` with ${qualification.deviations.length} deviation(s)`),
    namespace: step.namespace,
    entityType: 'step_qualification',
    entityId: qualification.id,
    inputSnapshot: { evalRunId: run.id, variantId: variant.id, deviations: input.deviations },
    outputSnapshot: {
      fingerprint: qualification.fingerprint.hash,
      briefVersion: qualification.briefVersion,
      verdicts: verdicts.map((verdict) => ({ severity: verdict.severity, status: verdict.status })),
      signature: qualification.signature,
    },
    basis: 'A person signed the Step Qualification (ADR-0023 D10, 21 CFR 11.50)',
  });
  return { qualification };
}
