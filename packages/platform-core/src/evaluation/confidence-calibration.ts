import type { AcceptanceCriterionVerdict, ConfidenceCalibration, ControlRecommendation } from '../schemas/eval-run';
import { wilsonInterval } from './statistics';

/** One graded trial: what the agent said of its output, and whether the output passed. */
export interface ConfidenceOutcome {
  readonly confidence: number;
  readonly passed: boolean;
}

const BIN_COUNT = 5;
/** Fewer trials than this above a threshold say too little to let them run without a person. */
const MIN_COVERED_TRIALS = 5;

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
 * What a variant's results say about routing its outputs. Control Mode 4 with
 * a `confidenceThreshold` when some confidence level separates outputs that
 * pass: the lowest threshold whose outputs at or above it passed every counted
 * Evaluator with a Wilson 95% lower bound of at least the strictest
 * criterion's `minPassRate`, over at least a handful of trials. Below it the
 * step's fallback routes the output — so a step that misses its criteria
 * overall can still run unreviewed where it is confident. Control Mode 3, a
 * person reviewing every output, when there are no criteria, a criterion could
 * not be judged, the agent reported no confidence, or no threshold holds.
 */
export function recommendControl(
  outcomes: readonly ConfidenceOutcome[],
  verdicts: readonly AcceptanceCriterionVerdict[],
): ControlRecommendation {
  const review = (reason: string): ControlRecommendation => ({
    autonomyLevel: 'L3', confidenceThreshold: null, coverage: null, reason,
  });
  if (verdicts.length === 0) {
    return review('No Acceptance Criteria were frozen into this run, so there is no floor to run unreviewed against; keep a person reviewing every output.');
  }
  const unjudged = verdicts.filter((verdict) => verdict.status === 'not_evaluable');
  if (unjudged.length > 0) {
    return review(`The ${unjudged.map((verdict) => verdict.severity).join(' and ')} criterion could not be judged; keep a person reviewing every output.`);
  }
  if (outcomes.length === 0) {
    return review('The agent reported no confidence to route on; keep a person reviewing every output.');
  }

  const allMet = verdicts.every((verdict) => verdict.status === 'met');
  const target = Math.max(...verdicts.map((verdict) => verdict.criterion.minPassRate));
  const thresholds = [...new Set(outcomes.map((outcome) => outcome.confidence))].sort((left, right) => left - right);
  for (const threshold of thresholds) {
    const covered = outcomes.filter((outcome) => outcome.confidence >= threshold);
    if (covered.length < MIN_COVERED_TRIALS) break;
    const passes = covered.filter((outcome) => outcome.passed === true).length;
    const lower = wilsonInterval(passes, covered.length)!.lower;
    if (lower >= target) {
      return {
        autonomyLevel: 'L4',
        confidenceThreshold: threshold,
        coverage: covered.length / outcomes.length,
        reason: `${allMet ? 'Every criterion was met, and outputs' : 'Not every criterion was met overall, but outputs'} with confidence ${threshold} or more `
          + `passed every counted Evaluator ${passes}/${covered.length} times (lower bound ${lower.toFixed(2)}, at least the strictest floor ${target}). `
          + 'Below the threshold the step\'s fallbackBehavior applies; escalate_to_human sends the output to a person.',
      };
    }
  }
  return review(
    `No confidence level separates outputs that pass every counted Evaluator with a lower bound of ${target} `
    + `over at least ${MIN_COVERED_TRIALS} trials; keep a person reviewing every output, or run more trials.`,
  );
}
