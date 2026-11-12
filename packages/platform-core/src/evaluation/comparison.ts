import type { ComparisonEvaluatorCall, ComparisonScope } from '../schemas/eval-comparison';
import type { EvalTrialOutcome, EvalVariantPatch } from '../schemas/eval-run';

/** How one Evaluator graded one trial of a run. */
export interface TrialGrade {
  readonly caseId: string;
  readonly evaluatorId: string;
  readonly outcome: EvalTrialOutcome;
}

export type CaseSplit = 'dev' | 'holdout';

/** Below this many non-tied cases no outcome of a two-sided sign test reaches p < 0.05 (ADR-0024 D5). */
const MIN_DECISIVE_CASES = 6;
const SIGNIFICANCE = 0.05;

function binomial(n: number, k: number): number {
  let result = 1;
  for (let index = 1; index <= k; index += 1) result = (result * (n - k + index)) / index;
  return result;
}

/** Two-sided exact sign test over paired wins and losses; null when there are none. */
export function signTestPValue(wins: number, losses: number): number | null {
  const decisive = wins + losses;
  if (decisive === 0) return null;
  let tail = 0;
  for (let count = 0; count <= Math.min(wins, losses); count += 1) tail += binomial(decisive, count);
  return Math.min(1, (2 * tail) / 2 ** decisive);
}

/** Each case's pass rate over its graded trials, for one Evaluator; a case with no graded trial is absent. */
function passRateByCase(grades: readonly TrialGrade[], evaluatorId: string): Map<string, number> {
  const tallies = new Map<string, { passes: number; graded: number }>();
  for (const grade of grades) {
    if (grade.evaluatorId !== evaluatorId || (grade.outcome !== 'pass' && grade.outcome !== 'fail')) continue;
    const tally = tallies.get(grade.caseId) ?? { passes: 0, graded: 0 };
    tallies.set(grade.caseId, { passes: tally.passes + (grade.outcome === 'pass' ? 1 : 0), graded: tally.graded + 1 });
  }
  return new Map([...tallies].map(([id, tally]) => [id, tally.passes / tally.graded]));
}

function call(evaluatorId: string, scope: ComparisonScope, pairs: ReadonlyArray<readonly [number, number]>): ComparisonEvaluatorCall {
  const wins = pairs.filter(([baseline, variant]) => variant > baseline).length;
  const losses = pairs.filter(([baseline, variant]) => variant < baseline).length;
  const pValue = signTestPValue(wins, losses);
  const verdict = wins + losses < MIN_DECISIVE_CASES || pValue === null
    ? 'too_few_cases'
    : pValue >= SIGNIFICANCE ? 'no_clear_difference' : wins > losses ? 'better' : 'worse';
  return { evaluatorId, scope, wins, losses, ties: pairs.length - wins - losses, pValue, call: verdict };
}

/**
 * A Variant against the baseline on the same cases (ADR-0024 D5): per
 * Evaluator, a case is a win when the Variant's pass rate over its trials is
 * higher, a loss when lower, a tie otherwise; a case either run could not
 * grade is left out. Read over every case and, given the cases' split, over
 * dev and holdout apart — a side with no paired case is too few cases.
 */
export function compareToBaseline(input: {
  readonly baseline: readonly TrialGrade[];
  readonly variant: readonly TrialGrade[];
  readonly evaluatorIds: readonly string[];
  readonly splitOf?: (caseId: string) => CaseSplit | null;
}): ComparisonEvaluatorCall[] {
  return input.evaluatorIds.flatMap((evaluatorId) => {
    const baselineRates = passRateByCase(input.baseline, evaluatorId);
    const variantRates = passRateByCase(input.variant, evaluatorId);
    const paired = [...baselineRates].flatMap(([id, baselineRate]) => {
      const variantRate = variantRates.get(id);
      return variantRate === undefined ? [] : [{ split: input.splitOf?.(id) ?? null, rates: [baselineRate, variantRate] as const }];
    });
    const calls = [call(evaluatorId, 'all', paired.map((pair) => pair.rates))];
    if (input.splitOf === undefined) return calls;
    for (const side of ['dev', 'holdout'] as const) {
      calls.push(call(evaluatorId, side, paired.filter((pair) => pair.split === side).map((pair) => pair.rates)));
    }
    return calls;
  });
}

/**
 * Which cases a Variant's recommendation reads (ADR-0024 D5): a prompt Variant
 * may have been written from dev cases, so it is judged on holdout when there
 * is one; a model Variant was fitted to no case, so it reads every case.
 */
export function recommendationScope(variant: EvalVariantPatch, hasHoldout: boolean): ComparisonScope {
  return variant.prompt !== undefined && hasHoldout === true ? 'holdout' : 'all';
}
