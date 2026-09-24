/** z for a two-sided 95% interval. */
const Z_95 = 1.959963984540054;

/**
 * Wilson score interval for a binomial proportion — the D10 judgment uses its
 * lower bound, which stays honest at the small n an Eval Run has, where the
 * normal approximation claims certainty it does not have.
 */
export function wilsonInterval(passes: number, total: number, z = Z_95): { lower: number; upper: number } | null {
  if (total === 0) return null;
  const rate = passes / total;
  const zSquared = z * z;
  const denominator = 1 + zSquared / total;
  const centre = (rate + zSquared / (2 * total)) / denominator;
  const margin = (z * Math.sqrt((rate * (1 - rate)) / total + zSquared / (4 * total * total))) / denominator;
  return { lower: Math.max(0, centre - margin), upper: Math.min(1, centre + margin) };
}

export interface CaseReliability {
  /** Share of cases where at least one trial passed. */
  readonly passAtK: number;
  /** Share of cases where every trial passed. */
  readonly passHatK: number;
  /** Share of cases with both a passing and a failing trial. */
  readonly flakiness: number;
}

/**
 * Per-case reliability over each case's trials (k = the trials a case had),
 * where `null` is a trial that ran but could not be graded: it never passes,
 * so it cannot lift pass@k or pass^k, and it never fails, so it cannot make a
 * case flaky. Cases with no trial are left out; null when none remain.
 */
export function caseReliability(outcomesByCase: ReadonlyMap<string, readonly (boolean | null)[]>): CaseReliability | null {
  const cases = [...outcomesByCase.values()].filter((outcomes) => outcomes.length > 0);
  if (cases.length === 0) return null;
  const share = (predicate: (outcomes: readonly (boolean | null)[]) => boolean) =>
    cases.filter(predicate).length / cases.length;
  return {
    passAtK: share((outcomes) => outcomes.some((passed) => passed === true)),
    passHatK: share((outcomes) => outcomes.every((passed) => passed === true)),
    flakiness: share((outcomes) => outcomes.some((passed) => passed === true) && outcomes.some((passed) => passed === false)),
  };
}
