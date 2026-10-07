import { LegacyEvaluatorSeveritySchema, type AcceptanceCriteria, type SignedAcceptanceCriteria } from '../schemas/evaluation';
import type { AcceptanceCriterionVerdict, EvalRun, EvalRunAcceptance, EvalRunEvaluatorReport, EvalRunReport } from '../schemas/eval-run';

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
 * Judges an Eval Run's Evaluator results against its Acceptance Criteria
 * (ADR-0023 D10). They hold when every counted Evaluator reaches them: its pass
 * rate — passes over graded trials, taken literally — at least `minPassRate`,
 * and its pass^k at least `minPassHatK` when set. One miss is a miss;
 * otherwise no counted Evaluator, or one that graded nothing it counts, cannot
 * be judged. Evaluators that do not count (D9) are left out.
 */
export function judgeAcceptanceCriteria(
  criteria: AcceptanceCriteria | null,
  evaluators: readonly EvalRunEvaluatorReport[],
): AcceptanceCriterionVerdict | null {
  if (criteria === null) return null;
  const lines = evaluators
    .filter((evaluator) => evaluator.counted === true)
    .map((evaluator) => {
      const passRateMet = evaluator.passRate === null ? null : evaluator.passRate >= criteria.minPassRate;
      const passHatKMet = criteria.minPassHatK === undefined
        ? true
        : evaluator.passHatK === null ? null : evaluator.passHatK >= criteria.minPassHatK;
      const met = passRateMet === false || passHatKMet === false ? false : passRateMet === null || passHatKMet === null ? null : true;
      const misses = [
        passRateMet === false && `pass rate ${percent(evaluator.passRate!)} < ${percent(criteria.minPassRate)}`,
        passHatKMet === false && `pass^k ${percent(evaluator.passHatK!)} < ${percent(criteria.minPassHatK!)}`,
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
    reason = 'No counted Evaluator';
  } else if (lines.some(({ line }) => line.met === false)) {
    status = 'missed';
    reason = lines.filter(({ line }) => line.met === false).map(({ explanation }) => explanation).join('; ');
  } else if (lines.some(({ line }) => line.met === null)) {
    status = 'not_evaluable';
    reason = lines.filter(({ line }) => line.met === null).map(({ explanation }) => explanation).join('; ');
  } else {
    status = 'met';
    reason = 'Every counted Evaluator reached it';
  }
  return { criterion: criteria, status, evaluators: lines.map(({ line }) => line), reason };
}

/** Until a Step's Acceptance Criteria are set, every Evaluator must pass every graded trial. */
export const DEFAULT_ACCEPTANCE_CRITERIA: AcceptanceCriteria = { minPassRate: 1 };

function describeFloor(criteria: AcceptanceCriteria): string {
  const passHatK = criteria.minPassHatK === undefined ? '' : `, pass^k ≥ ${criteria.minPassHatK}`;
  return `pass rate ≥ ${criteria.minPassRate}${passHatK}`;
}

/** Acceptance Criteria in words: the pass-rate floor, and pass^k where set — per severity on criteria signed while Evaluators had one. */
export function describeAcceptanceCriteria(criteria: SignedAcceptanceCriteria): string {
  if ('minPassRate' in criteria) return describeFloor(criteria);
  return LegacyEvaluatorSeveritySchema.options
    .flatMap((severity) => {
      const floor = criteria[severity];
      return floor === undefined ? [] : [`${severity}: ${describeFloor(floor)}`];
    })
    .join('; ');
}

/**
 * How an Eval Run fared on the criteria frozen into it — the
 * step's validation when the run is its newest finished one. Null while the
 * run is prepared or running.
 */
export function evalRunAcceptance(
  run: Pick<EvalRun, 'status'>,
  report: Pick<EvalRunReport, 'criteriaVerdict'>,
): EvalRunAcceptance | null {
  if (run.status === 'prepared' || run.status === 'running') return null;
  const verdict = report.criteriaVerdict;
  if (verdict === null) return { status: 'no_criteria', reason: 'No Acceptance Criteria were frozen into this run.' };
  if (verdict.status === 'met') return { status: 'met', reason: 'Acceptance Criteria met.' };
  return verdict.status === 'missed'
    ? { status: 'missed', reason: verdict.reason }
    : { status: 'not_judged', reason: verdict.reason };
}
