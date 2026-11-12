import type { z } from 'zod';
import { applyAgentVariant, applyStepVariant, isEmptyVariant } from '@mediforce/platform-core';
import type { ApplyVariantInputSchema, ApplyVariantOutput } from '../../contract/evaluation';
import type { CallerScope } from '../../repositories/index';
import { ForbiddenError, ValidationError } from '../../errors';
import { loadEvaluationSubject, subjectName, subjectRef } from './_lib/evaluation-subject';
import { computeStepFingerprint } from './_lib/step-fingerprint';
import { appendEvaluationAudit } from './_lib/audit';
import { agentConfigHash, agentConfigOf, recordAgentVersion } from '../agents/_lib/agent-version';
import { registerWorkflow } from '../workflows/register-workflow';
import { setDefaultWorkflowVersion } from '../workflows/set-default-version';
import { loadComparison, loadRun } from './comparisons';

/**
 * Applies a Comparison's winning Variant for real (ADR-0024 D6): a Step gets
 * a new Workflow Definition version with the patch applied, through
 * `registerWorkflow`; an Agent gets a new version with its foundation model
 * or system prompt replaced. Refused unless the subject, patched, still
 * matches what the run assessed — the subject changed since the Comparison
 * was prepared, so it must be prepared again.
 */
export async function applyVariant(
  input: z.output<typeof ApplyVariantInputSchema>,
  scope: CallerScope,
): Promise<ApplyVariantOutput> {
  if (scope.caller.kind !== 'user') throw new ForbiddenError('A Variant is applied by a person; an API key cannot apply one');
  const comparison = await loadComparison(scope, input.comparisonId);
  const subject = subjectRef(comparison);
  const run = await loadRun(scope, input.evalRunId);
  if (run.comparisonId !== comparison.id) {
    throw new ValidationError(`Eval Run '${run.id}' is not a run of Comparison '${comparison.id}'`);
  }
  if (run.variant === null || isEmptyVariant(run.variant)) {
    throw new ValidationError(`Eval Run '${run.id}' ran the baseline, not a Variant; apply a Variant's run`);
  }
  const changedError = new ValidationError(`${subjectName(subject)} changed since the Comparison was prepared; prepare it again`);
  const { definition, step: workflowStep, agent } = await loadEvaluationSubject(scope, subject, 'edit');

  if (agent === null) {
    const patched = applyStepVariant(definition, workflowStep, run.variant);
    const fingerprint = await computeStepFingerprint(scope, patched.definition, patched.step);
    if (run.fingerprint === null || fingerprint.hash !== run.fingerprint.hash) throw changedError;
    const { namespace, version: _version, createdAt: _createdAt, ...body } = patched.definition;
    const registered = await registerWorkflow({ ...body, namespace }, scope);
    if (input.makeDefault) await setDefaultWorkflowVersion({ namespace, name: registered.name, version: registered.version }, scope);
    await appendEvaluationAudit(scope, {
      action: 'eval_variant.applied',
      description: `Variant from Eval Run '${run.id}' applied to ${subjectName(subject, false)} as v${registered.version} (Comparison '${comparison.id}')`,
      namespace,
      entityType: 'workflow_definition',
      entityId: registered.name,
      inputSnapshot: { comparisonId: comparison.id, evalRunId: run.id, variant: run.variant, makeDefault: input.makeDefault },
      outputSnapshot: { definitionVersion: registered.version },
      basis: 'A person applied a Comparison\'s winning Variant (ADR-0024 D6)',
    });
    return { definitionVersion: registered.version, agentVersion: null };
  }

  const patchedAgent = applyAgentVariant(agent, run.variant);
  const hash = agentConfigHash(await agentConfigOf(scope, patchedAgent));
  if (run.variantAgentHash === null || hash !== run.variantAgentHash) throw changedError;
  const saved = await scope.agentDefinitions.update(agent.id, {
    ...(run.variant.model === undefined ? {} : { foundationModel: run.variant.model }),
    ...(run.variant.prompt === undefined ? {} : { systemPrompt: run.variant.prompt }),
  });
  const agentVersion = await recordAgentVersion(scope, saved);
  await appendEvaluationAudit(scope, {
    action: 'eval_variant.applied',
    description: `Variant from Eval Run '${run.id}' applied to ${subjectName(subject, false)} as v${agentVersion.version} (Comparison '${comparison.id}')`,
    namespace: agent.namespace ?? '',
    entityType: 'agentDefinition',
    entityId: agent.id,
    inputSnapshot: { comparisonId: comparison.id, evalRunId: run.id, variant: run.variant },
    outputSnapshot: { agentVersion: agentVersion.version },
    basis: 'A person applied a Comparison\'s winning Variant (ADR-0024 D6)',
  });
  return { definitionVersion: null, agentVersion: agentVersion.version };
}
