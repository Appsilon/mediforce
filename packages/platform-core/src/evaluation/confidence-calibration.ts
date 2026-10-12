import type { AcceptanceCriterionVerdict, ConfidenceCalibration, ControlRecommendation } from '../schemas/eval-run';

/** One graded trial: what the agent said of its output, and whether the output passed. */
export interface ConfidenceOutcome {
  readonly confidence: number;
  readonly passed: boolean;
}

const BIN_COUNT = 5;

/**
 * The reliability curve of agent-reported confidence — equal-width bins, each
 * with its mean confidence and actual pass rate — and the expected
 * calibration error: the count-weighted gap between the two. Null with no
 * outcomes.
 */
export function calibrateConfidence(outcomes: readonly ConfidenceOutcome[]): ConfidenceCalibration | null {
  if (outcomes.length === 0) return null;
  const bins = Array.from({ length: BIN_COUNT }, (_unused, index) => ({
    lower: index / BIN_COUNT,
    upper: (index + 1) / BIN_COUNT,
    members: [] as ConfidenceOutcome[],
  }));
  for (const outcome of outcomes) {
    bins[Math.min(BIN_COUNT - 1, Math.floor(outcome.confidence * BIN_COUNT))]!.members.push(outcome);
  }
  const filled = bins
    .filter((bin) => bin.members.length > 0)
    .map((bin) => ({
      lower: bin.lower,
      upper: bin.upper,
      count: bin.members.length,
      meanConfidence: bin.members.reduce((sum, member) => sum + member.confidence, 0) / bin.members.length,
      passRate: bin.members.filter((member) => member.passed === true).length / bin.members.length,
    }));
  const ece = filled.reduce((sum, bin) => sum + (bin.count / outcomes.length) * Math.abs(bin.passRate - bin.meanConfidence), 0);
  return { count: outcomes.length, bins: filled, ece: Math.min(1, ece) };
}

/**
 * What an Eval Run's results say about routing the step's outputs: Control
 * Mode 4, the agent applying its output unreviewed, when every counted
 * Evaluator met the Acceptance Criteria; Control Mode 3, a person reviewing
 * every output, when there are no criteria, they could not be judged, or they
 * were missed.
 */
export function recommendControl(verdict: AcceptanceCriterionVerdict | null): ControlRecommendation {
  if (verdict === null) {
    return { autonomyLevel: 'L3', reason: 'No Acceptance Criteria were frozen into this run, so there is no floor to run unreviewed against; keep a person reviewing every output.' };
  }
  if (verdict.status === 'not_evaluable') {
    return { autonomyLevel: 'L3', reason: 'The Acceptance Criteria could not be judged; keep a person reviewing every output.' };
  }
  if (verdict.status === 'met') {
    return { autonomyLevel: 'L4', reason: `Outputs passed every counted Evaluator at or above the floor ${verdict.criterion.minPassRate}; the agent can apply its output without a person.` };
  }
  return { autonomyLevel: 'L3', reason: `Outputs missed the floor ${verdict.criterion.minPassRate}; keep a person reviewing every output, or fix the failures and run again.` };
}
