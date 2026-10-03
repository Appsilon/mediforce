import { EvaluatorSeveritySchema, type AcceptanceCriteria } from '../schemas/evaluation';
import { CHAMPION_VARIANT_ID, type AcceptanceCriterionVerdict, type EvalRun, type EvalRunAcceptance, type EvalRunEvaluatorReport, type EvalRunVariantReport } from '../schemas/eval-run';

const SEVERITIES = EvaluatorSeveritySchema.options;

function percent(value: number): string {
  return `${Math.round(value * 1000) / 10}%`;
}

/** Why an Evaluator has no rate: it graded nothing, or every verdict it gave was left out. */
function notGraded(evaluator: EvalRunEvaluatorReport): string {
  if (evaluator.excluded === 0) return `${evaluator.name} graded no trial`;
  const verdicts = evaluator.excluded === 1 ? 'verdict' : 'verdicts';
  return `${evaluator.name} counted no trial: ${evaluator.excluded} ${verdicts} left out — below its minimum confidence, or denied by a person`;
}

/**
 * Judges one variant's Evaluator results against the run's Acceptance
 * Criteria (ADR-0023 D10). A criterion holds for a severity when every counted
 * Evaluator of that severity reaches it: its pass rate — passes over graded
 * trials, taken literally — at least `minPassRate`, and its pass^k at least
 * `minPassHatK` when set. One miss is a miss; otherwise a severity with no counted Evaluator, or
 * one that graded nothing it counts, cannot be judged. Evaluators that do not
 * count (D9) are left out.
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
        const passRateMet = evaluator.passRate === null ? null : evaluator.passRate >= criterion.minPassRate;
        const passHatKMet = criterion.minPassHatK === undefined
          ? true
          : evaluator.passHatK === null ? null : evaluator.passHatK >= criterion.minPassHatK;
        const met = passRateMet === false || passHatKMet === false ? false : passRateMet === null || passHatKMet === null ? null : true;
        const misses = [
          passRateMet === false && `pass rate ${percent(evaluator.passRate!)} < ${percent(criterion.minPassRate)}`,
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
          explanation: met === false ? `${evaluator.name}: ${misses.join(', ')}` : met === null ? notGraded(evaluator) : null,
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

/** Until a Step's Acceptance Criteria are set, every severity must pass every graded trial. */
export const DEFAULT_ACCEPTANCE_CRITERIA: AcceptanceCriteria = {
  critical: { minPassRate: 1 },
  major: { minPassRate: 1 },
  minor: { minPassRate: 1 },
};

/** Acceptance Criteria in words: the pass-rate floor per severity, and pass^k where set. */
export function describeAcceptanceCriteria(criteria: AcceptanceCriteria): string {
  return SEVERITIES
    .flatMap((severity) => {
      const criterion = criteria[severity];
      if (criterion === undefined) return [];
      const passHatK = criterion.minPassHatK === undefined ? '' : `, pass^k ≥ ${criterion.minPassHatK}`;
      return [`${severity}: pass rate ≥ ${criterion.minPassRate}${passHatK}`];
    })
    .join('; ');
}

/**
 * How an Eval Run's champion fared on the criteria frozen into it — the
 * step's validation when the run is its newest finished one. Null while the
 * run is prepared or running.
 */
export function evalRunAcceptance(
  run: Pick<EvalRun, 'status' | 'acceptanceCriteria'>,
  report: { variants: ReadonlyArray<Pick<EvalRunVariantReport, 'id' | 'criteria'>> },
): EvalRunAcceptance | null {
  if (run.status === 'prepared' || run.status === 'running') return null;
  if (run.acceptanceCriteria === null) return { status: 'no_criteria', reason: 'No Acceptance Criteria were frozen into this run.' };
  const verdicts = report.variants.find((variant) => variant.id === CHAMPION_VARIANT_ID)?.criteria ?? [];
  const unmet = verdicts.filter((verdict) => verdict.status !== 'met');
  if (unmet.length === 0) return { status: 'met', reason: 'Every criterion met.' };
  return {
    status: unmet.some((verdict) => verdict.status === 'missed') ? 'missed' : 'not_judged',
    reason: unmet.map((verdict) => `${verdict.severity} ${verdict.status === 'missed' ? 'missed' : 'not judged'}`).join(', '),
  };
}
