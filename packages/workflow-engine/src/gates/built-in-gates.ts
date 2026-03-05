import type { GateFunction } from './gate-types.js';

/**
 * Gate that always approves passage. The empty `next` signals the engine
 * should use the transition's `to` field directly.
 */
export const alwaysProceed: GateFunction = () => ({
  next: '',
  reason: 'Unconditional transition',
});

/**
 * Creates a gate function for simple review workflows.
 * Routes based on the latest verdict in reviewVerdicts.
 * Defaults to revise target when no verdict or unknown verdict is present.
 */
export function createSimpleReviewGate(
  targets: { approve: string; revise: string; reject: string },
): GateFunction {
  return (input) => {
    const verdicts = input.reviewVerdicts;
    if (!verdicts || verdicts.length === 0) {
      return { next: targets.revise, reason: 'No verdict provided, defaulting to revise' };
    }

    const latest = verdicts[verdicts.length - 1];
    const target = targets[latest.verdict as keyof typeof targets];

    if (!target) {
      return {
        next: targets.revise,
        reason: `Unknown verdict "${latest.verdict}", defaulting to revise`,
      };
    }

    return { next: target, reason: `Verdict: ${latest.verdict}` };
  };
}
