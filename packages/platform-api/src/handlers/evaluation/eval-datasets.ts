import { randomUUID } from 'node:crypto';
import type {
  SaveEvalDatasetInput,
  SaveEvalDatasetOutput,
  ListEvalDatasetsInput,
  ListEvalDatasetsOutput,
} from '../../contract/evaluation';
import type { CallerScope } from '../../repositories/index';
import { ValidationError } from '../../errors';
import { loadEvaluatedStep, stepRef } from './_lib/evaluated-step';
import { appendEvaluationAudit, authorId } from './_lib/audit';

export async function listEvalDatasets(input: ListEvalDatasetsInput, scope: CallerScope): Promise<ListEvalDatasetsOutput> {
  await loadEvaluatedStep(scope, input, 'read');
  return { datasets: await scope.evaluation.listDatasetVersions(stepRef(input)) };
}

/**
 * Saves a new Eval Dataset version: the Step's live cases, or the ones named.
 * A version never changes afterwards, so an Eval Run that ran it can always be
 * read against exactly the cases it ran.
 */
export async function saveEvalDataset(input: SaveEvalDatasetInput, scope: CallerScope): Promise<SaveEvalDatasetOutput> {
  const step = stepRef(input);
  await loadEvaluatedStep(scope, step, 'edit');
  const cases = await scope.evaluation.listCases(step);
  const selected = input.caseIds === undefined
    ? cases.filter((evalCase) => !evalCase.archived)
    : input.caseIds.map((caseId) => {
      const evalCase = cases.find((candidate) => candidate.id === caseId);
      if (evalCase === undefined) throw new ValidationError(`Eval Case '${caseId}' is not a case of step '${step.stepId}'`);
      return evalCase;
    });
  if (selected.length === 0) throw new ValidationError(`Step '${step.stepId}' has no Eval Cases to save`);

  const [current] = await scope.evaluation.listDatasetVersions(step);
  const dataset = await scope.evaluation.appendDatasetVersion({
    ...step,
    id: randomUUID(),
    version: (current?.version ?? 0) + 1,
    caseIds: selected.map((evalCase) => evalCase.id),
    containsProductionData: selected.some((evalCase) => evalCase.containsProductionData),
    createdBy: authorId(scope),
    createdAt: new Date().toISOString(),
  });
  await appendEvaluationAudit(scope, {
    action: 'eval_dataset.saved',
    description: `Eval Dataset v${dataset.version} saved for step '${step.stepId}' with ${dataset.caseIds.length} case(s)`,
    namespace: step.namespace,
    entityType: 'eval_dataset',
    entityId: dataset.id,
    inputSnapshot: { ...step, caseIds: dataset.caseIds },
    outputSnapshot: { version: dataset.version, containsProductionData: dataset.containsProductionData },
    basis: 'An Eval Dataset version is a saved set of Eval Cases (ADR-0023)',
  });
  return { dataset };
}
