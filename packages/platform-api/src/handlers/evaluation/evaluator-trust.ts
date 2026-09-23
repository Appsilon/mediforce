import { JUDGE_PASS_VALUE, type Score } from '@mediforce/platform-core';
import type {
  ApproveEvaluatorSourceInput,
  CalibrateEvaluatorInput,
  CalibrateEvaluatorOutput,
  EvaluatorOutput,
  LabelEvaluatorOutputInput,
  LabelEvaluatorOutputOutput,
} from '../../contract/evaluation';
import type { CallerScope } from '../../repositories/index';
import { NotFoundError, ValidationError } from '../../errors';
import { resolveTargetUid } from '../_helpers';
import { recordScore } from '../scores/record-score';
import { loadEvaluatedStep, stepRef } from './_lib/evaluated-step';
import { evaluatorView, loadEvaluator } from './_lib/evaluator-view';
import { loadEvaluationSubject } from './_lib/evaluation-subject';
import { runEvaluatorCheck } from './_lib/run-evaluator-check';
import { appendEvaluationAudit } from './_lib/audit';

/**
 * A person approves one version of a `code` Evaluator's source (D9) — the
 * approval is what lets it count. There is deliberately no assistant tool
 * for this (D15): the Evaluation Assistant may write check code, never vouch
 * for it.
 */
export async function approveEvaluatorSource(
  input: ApproveEvaluatorSourceInput,
  scope: CallerScope,
): Promise<EvaluatorOutput> {
  const approvedBy = resolveTargetUid(input, scope, 'approval', 'approve an Evaluator\'s source');
  const evaluator = await loadEvaluator(scope, input.evaluatorId);
  await loadEvaluatedStep(scope, stepRef(evaluator), 'edit');
  const view = await evaluatorView(scope, evaluator);
  const version = view.versions.find((candidate) => candidate.version === input.version);
  if (version === undefined) throw new NotFoundError(`Evaluator '${evaluator.name}' has no version ${input.version}`);
  if (version.check.kind !== 'code') {
    throw new ValidationError(`Only a code check's source is approved; v${input.version} is a ${version.check.kind} check`);
  }

  const approval = { approvedBy, approvedAt: new Date().toISOString() };
  await scope.evaluation.setSourceApproval(evaluator, input.version, approval);
  await appendEvaluationAudit(scope, {
    action: 'evaluator.source_approved',
    description: `Source of Evaluator '${evaluator.name}' v${input.version} approved by ${approvedBy}`,
    namespace: evaluator.namespace,
    entityType: 'evaluator',
    entityId: evaluator.id,
    inputSnapshot: { version: input.version, source: version.check.source, runtime: version.check.runtime },
    outputSnapshot: approval,
    basis: 'A code Evaluator counts only after a recorded human approval of its source (ADR-0023 D9)',
  });
  return { evaluator: await evaluatorView(scope, evaluator) };
}

/**
 * A person's pass/fail on one Agent Run's output for this Evaluator: the
 * ground truth a judge is calibrated against, stored as a human Score. A
 * relabel supersedes the earlier label, so the history stays.
 */
export async function labelEvaluatorOutput(
  input: LabelEvaluatorOutputInput,
  scope: CallerScope,
): Promise<LabelEvaluatorOutputOutput> {
  const labelledBy = resolveTargetUid(input, scope, 'label', 'label an output');
  const evaluator = await loadEvaluator(scope, input.evaluatorId);
  const step = stepRef(evaluator);
  await loadEvaluatedStep(scope, step, 'edit');
  const subject = await loadEvaluationSubject(scope, input.agentRunId, step);
  const [previous] = await scope.scores.list({
    agentRunId: input.agentRunId,
    evaluatorId: evaluator.id,
    source: 'human',
    limit: 1,
  });

  const score = await recordScore({
    subject: { type: 'agent_run', id: input.agentRunId },
    name: evaluator.name,
    value: input.passed ? 1 : 0,
    label: input.passed ? 'pass' : 'fail',
    comment: input.comment ?? null,
    source: 'human',
    createdBy: labelledBy,
    metadata: { calibrationLabel: true },
    namespace: evaluator.namespace,
    processInstanceId: subject.instance.id,
    stepId: step.stepId,
    evaluatorId: evaluator.id,
    supersedes: previous?.id ?? null,
    basis: 'Human label for Evaluator calibration (ADR-0023 D9)',
  }, scope);
  return { score };
}

/** The newest human label per Agent Run. */
function latestLabels(scores: readonly Score[]): Score[] {
  const seen = new Set<string>();
  const latest: Score[] = [];
  for (const score of scores) {
    if (seen.has(score.subject.id)) continue;
    seen.add(score.subject.id);
    latest.push(score);
  }
  return latest;
}

/**
 * Runs a judge version over every output a person has labelled for this
 * Evaluator and records how often it agreed (D9). Outputs the judge could not
 * grade are reported and left out of the agreement.
 */
export async function calibrateEvaluator(
  input: CalibrateEvaluatorInput,
  scope: CallerScope,
): Promise<CalibrateEvaluatorOutput> {
  const evaluator = await loadEvaluator(scope, input.evaluatorId);
  const step = stepRef(evaluator);
  await loadEvaluatedStep(scope, step, 'edit');
  const view = await evaluatorView(scope, evaluator);
  const version = input.version === undefined
    ? view.latest
    : view.versions.find((candidate) => candidate.version === input.version);
  if (version === undefined) throw new NotFoundError(`Evaluator '${evaluator.name}' has no version ${input.version}`);
  if (version.check.kind !== 'llm_judge') {
    throw new ValidationError(`Only an llm_judge is calibrated; v${version.version} is a ${version.check.kind} check`);
  }

  const labels = latestLabels(await scope.scores.list({ evaluatorId: evaluator.id, source: 'human', limit: 1000 }));
  if (labels.length === 0) throw new ValidationError(`Evaluator '${evaluator.name}' has no labelled outputs to calibrate against`);

  const disagreements: CalibrateEvaluatorOutput['disagreements'] = [];
  const errors: CalibrateEvaluatorOutput['errors'] = [];
  let graded = 0;
  let failures = 0;
  for (const label of labels) {
    const humanPassed = label.value >= JUDGE_PASS_VALUE;
    const subject = await loadEvaluationSubject(scope, label.subject.id, step);
    const outcome = await runEvaluatorCheck(scope, version.check, subject, null);
    if (outcome.passed === null) {
      errors.push({ agentRunId: label.subject.id, error: outcome.error ?? 'judge returned no verdict' });
      continue;
    }
    graded += 1;
    if (!humanPassed) failures += 1;
    if (outcome.passed !== humanPassed) {
      disagreements.push({ agentRunId: label.subject.id, humanPassed, judgePassed: outcome.passed });
    }
  }

  const calibration = {
    agreement: graded === 0 ? 0 : (graded - disagreements.length) / graded,
    labelCount: graded,
    failureLabelCount: failures,
    calibratedAt: new Date().toISOString(),
  };
  await scope.evaluation.setCalibration(evaluator, version.version, calibration);
  await appendEvaluationAudit(scope, {
    action: 'evaluator.calibrated',
    description: `Evaluator '${evaluator.name}' v${version.version} calibrated: agreement ${calibration.agreement.toFixed(2)} on ${graded} labels`,
    namespace: evaluator.namespace,
    entityType: 'evaluator',
    entityId: evaluator.id,
    inputSnapshot: { version: version.version, labels: labels.length },
    outputSnapshot: { ...calibration, disagreements: disagreements.length, errors: errors.length },
    basis: 'A judge counts only at or above set agreement with human labels (ADR-0023 D9)',
  });
  return { evaluator: await evaluatorView(scope, evaluator), disagreements, errors };
}
