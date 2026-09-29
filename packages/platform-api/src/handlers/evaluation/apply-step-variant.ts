import {
  CHAMPION_VARIANT_ID,
  applyStepVariant,
  resolveRunnableVersion,
  type StepFingerprint,
  type StepVariantPatch,
} from '@mediforce/platform-core';
import type { ApplyStepVariantInput, ApplyStepVariantOutput } from '../../contract/evaluation';
import { RegisterWorkflowInputSchema, buildRegisterBody } from '../../contract/workflows';
import type { CallerScope } from '../../repositories/index';
import { NotFoundError, ValidationError } from '../../errors';
import { registerWorkflow } from '../workflows/register-workflow';
import { setDefaultWorkflowVersion } from '../workflows/set-default-version';
import { isSameStep, loadEvaluatedStep, stepRef } from './_lib/evaluated-step';
import { appendEvaluationAudit } from './_lib/audit';
import { changedFingerprintComponents, computeStepFingerprint } from './_lib/step-fingerprint';
import { stepPatchProblem } from './_lib/step-patch-problem';

/**
 * Applies a variant to the Step (ADR-0023 D5): the patch of a challenger of
 * one of the Step's Eval Runs, or a patch given directly, over the Step as its
 * runnable Definition version has it, saved as a new Workflow Definition
 * version through the workflow editor's own save (`registerWorkflow`) — made
 * the default version only when `setAsDefault` is set, as the editor's save
 * dialog does. The champion is refused: it is the Step as it is. Returns the
 * new Step's Fingerprint, and for a run's variant whether it equals the one
 * frozen with it — then a Step Qualification of that variant holds for the new
 * version.
 */
export async function applyVariantToStep(
  input: ApplyStepVariantInput,
  scope: CallerScope,
): Promise<ApplyStepVariantOutput> {
  const step = stepRef(input);
  const { definition, step: workflowStep } = await loadEvaluatedStep(scope, step, 'edit');

  let patch: StepVariantPatch;
  let applied: { evalRunId: string; variantId: string; label: string; frozen: StepFingerprint | null } | null = null;
  if (input.patch === undefined) {
    const { evalRunId, variantId } = input;
    if (evalRunId === undefined || variantId === undefined) {
      throw new ValidationError('give either evalRunId and variantId (a challenger of an Eval Run) or patch');
    }
    if (variantId === CHAMPION_VARIANT_ID) {
      throw new ValidationError('The champion is the step as it is — there is nothing to apply');
    }
    const run = await scope.evaluation.getEvalRun(evalRunId);
    if (run === null || isSameStep(run, step) === false) {
      throw new NotFoundError(`Eval Run '${evalRunId}' is not a run of this step`);
    }
    const variant = run.variants.find((candidate) => candidate.id === variantId);
    if (variant === undefined) {
      throw new NotFoundError(`Eval Run '${evalRunId}' has no variant '${variantId}'; its variants are ${run.variants.map((candidate) => candidate.id).join(', ')}`);
    }
    patch = variant.patch;
    applied = { evalRunId, variantId, label: variant.label, frozen: variant.fingerprint };
  } else {
    patch = input.patch;
  }

  const problem = await stepPatchProblem(scope, step, definition, workflowStep, patch);
  if (problem !== null) throw new ValidationError(`Cannot apply to step '${step.stepId}': ${problem}`);

  const patched = applyStepVariant(definition, workflowStep, patch);
  const registered = await registerWorkflow(
    { ...RegisterWorkflowInputSchema.parse(buildRegisterBody(patched.definition, {})), namespace: step.namespace },
    scope,
  );
  if (input.setAsDefault) {
    await setDefaultWorkflowVersion({ namespace: step.namespace, name: step.workflowName, version: registered.version }, scope);
  }

  const saved = await scope.workflowDefinitions.get(step.namespace, step.workflowName, registered.version);
  const savedStep = saved?.steps.find((candidate) => candidate.id === step.stepId);
  if (saved === null || savedStep === undefined) {
    throw new NotFoundError(`Workflow '${step.workflowName}' v${registered.version} not found after saving`);
  }
  const fingerprint = await computeStepFingerprint(scope, saved, savedStep);
  const resolution = await resolveRunnableVersion(scope.workflowDefinitions, step.namespace, step.workflowName);
  const runnable = resolution.ok && resolution.def.version === registered.version;

  const variant = applied === null ? null : {
    evalRunId: applied.evalRunId,
    variantId: applied.variantId,
    label: applied.label,
    matchesFingerprint: applied.frozen !== null && applied.frozen.hash === fingerprint.hash,
    changed: applied.frozen === null ? [] : changedFingerprintComponents(applied.frozen, fingerprint),
  };

  await appendEvaluationAudit(scope, {
    action: 'step_variant.applied',
    description: `Variant applied to step '${step.stepId}' of workflow '${step.workflowName}': saved as v${registered.version}${input.setAsDefault ? ' and made the default' : ''}`,
    namespace: step.namespace,
    entityType: 'workflow_definition',
    entityId: step.workflowName,
    inputSnapshot: {
      ...step,
      patch,
      basedOnVersion: definition.version,
      ...(applied === null ? {} : { evalRunId: applied.evalRunId, variantId: applied.variantId }),
    },
    outputSnapshot: {
      definitionVersion: registered.version,
      fingerprint: fingerprint.hash,
      runnable,
      ...(variant === null ? {} : { matchesFingerprint: variant.matchesFingerprint }),
    },
    basis: 'A variant was applied to the Step by saving a new Workflow Definition version (ADR-0023 D5)',
  });

  return {
    definitionVersion: registered.version,
    runnable,
    fingerprint,
    variant,
    ...(registered.warnings === undefined ? {} : { warnings: registered.warnings }),
  };
}
