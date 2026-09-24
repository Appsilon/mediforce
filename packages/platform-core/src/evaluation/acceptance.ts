import { EvaluatorSeveritySchema, type AcceptanceCriteria } from '../schemas/evaluation';
import type { AcceptanceCriterionVerdict, EvalRunEvaluatorReport } from '../schemas/eval-run';

const SEVERITIES = EvaluatorSeveritySchema.options;

function percent(value: number): string {
  return `${Math.round(value * 1000) / 10}%`;
}

/**
 * Judges one variant's Evaluator results against the run's Acceptance
 * Criteria (ADR-0023 D10). A criterion holds for a severity when every counted
 * Evaluator of that severity reaches it: its pass rate's Wilson 95% lower
 * bound at least `minPassRate`, and its pass^k at least `minPassHatK` when
 * set. One miss is a miss; otherwise a severity with no counted Evaluator, or
 * one that graded nothing, cannot be judged. Evaluators that do not count
 * (D9) are left out.
 */
export function judgeAcceptanceCriteria(
  criteria: AcceptanceCriteria | null,
  evaluators: readonly EvalRunEvaluatorReport[],
): AcceptanceCriterionVerdict[] {
  if (criteria === null) return [];
  return SEVERITIES.flatMap((severity) => {
    const criterion = criteria[severity];
    if (criterion === undefined) return [];
    const lines = evaluators
      .filter((evaluator) => evaluator.counted === true && evaluator.severity === severity)
      .map((evaluator) => {
        const passRateMet = evaluator.wilsonLower === null ? null : evaluator.wilsonLower >= criterion.minPassRate;
        const passHatKMet = criterion.minPassHatK === undefined
          ? true
          : evaluator.passHatK === null ? null : evaluator.passHatK >= criterion.minPassHatK;
        const met = passRateMet === false || passHatKMet === false ? false : passRateMet === null || passHatKMet === null ? null : true;
        const misses = [
          passRateMet === false && `lower bound ${percent(evaluator.wilsonLower!)} < ${percent(criterion.minPassRate)}`,
          passHatKMet === false && `pass^k ${percent(evaluator.passHatK!)} < ${percent(criterion.minPassHatK!)}`,
        ].filter((miss) => miss !== false);
        return {
          line: {
            evaluatorId: evaluator.evaluatorId,
            name: evaluator.name,
            wilsonLower: evaluator.wilsonLower,
            passHatK: evaluator.passHatK,
            met,
          },
          explanation: met === false ? `${evaluator.name}: ${misses.join(', ')}` : met === null ? `${evaluator.name} graded no trial` : null,
        };
      });

    let status: AcceptanceCriterionVerdict['status'];
    let reason: string;
    if (lines.length === 0) {
      status = 'not_evaluable';
      reason = `No counted ${severity} Evaluator`;
    } else if (lines.some(({ line }) => line.met === false)) {
      status = 'missed';
      reason = lines.filter(({ line }) => line.met === false).map(({ explanation }) => explanation).join('; ');
    } else if (lines.some(({ line }) => line.met === null)) {
      status = 'not_evaluable';
      reason = lines.filter(({ line }) => line.met === null).map(({ explanation }) => explanation).join('; ');
    } else {
      status = 'met';
      reason = `Every counted ${severity} Evaluator reached it`;
    }
    return [{ severity, criterion, status, evaluators: lines.map(({ line }) => line), reason }];
  });
}

/** Acceptance Criteria in words: the floor per severity, on the Wilson 95% lower bound, and pass^k where set. */
export function describeAcceptanceCriteria(criteria: AcceptanceCriteria): string {
  return SEVERITIES
    .flatMap((severity) => {
      const criterion = criteria[severity];
      if (criterion === undefined) return [];
      const passHatK = criterion.minPassHatK === undefined ? '' : `, pass^k ≥ ${criterion.minPassHatK}`;
      return [`${severity}: lower bound ≥ ${criterion.minPassRate}${passHatK}`];
    })
    .join('; ');
}
