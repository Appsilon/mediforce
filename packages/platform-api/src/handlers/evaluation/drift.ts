import type { z } from 'zod';
import { detectDrift } from '@mediforce/platform-core';
import type { EvaluatorDrift, GetStepDriftInputSchema, GetStepDriftOutput } from '../../contract/evaluation';
import type { CallerScope } from '../../repositories/index';
import { loadEvaluatedStep, stepRef } from './_lib/evaluated-step';
import { listProductionEvaluators } from './_lib/production-evaluators';

/**
 * Drift alerts: for each Evaluator scoring the Step's production runs now, the
 * rolling mean of its production Scores — latest version only, so a changed
 * rule is not read as drift — against the window before. Computed on read;
 * nothing is stored.
 */
export async function getStepDrift(
  input: z.output<typeof GetStepDriftInputSchema>,
  scope: CallerScope,
): Promise<GetStepDriftOutput> {
  const step = stepRef(input);
  await loadEvaluatedStep(scope, step, 'read');
  const settings = {
    window: input.window ?? scope.system.driftSettings.window,
    threshold: input.threshold ?? scope.system.driftSettings.threshold,
  };
  const evaluators: EvaluatorDrift[] = [];
  for (const { evaluator, version } of await listProductionEvaluators(scope, step)) {
    const scores = await scope.scores.list({
      evaluatorId: evaluator.id,
      namespace: step.namespace,
      production: true,
      evaluatorVersion: version.version,
      limit: settings.window * 2,
    });
    const values = scores.map((score) => score.value);
    evaluators.push({
      evaluatorId: evaluator.id,
      name: evaluator.name,
      severity: version.severity,
      evaluatorVersion: version.version,
      ...detectDrift(values, settings),
    });
  }
  evaluators.sort((left, right) => Number(right.drifting) - Number(left.drifting));
  return { ...settings, evaluators };
}
