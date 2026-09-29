import type { EvaluatorVersion } from '../schemas/evaluation';

/** D9: a judge counts only after agreeing with at least this many human labels… */
export const JUDGE_MIN_LABELS = 10;
/** …at least this many of them failures… */
export const JUDGE_MIN_FAILURE_LABELS = 2;
/** …at this agreement or better. */
export const JUDGE_MIN_AGREEMENT = 0.8;

export type EvaluatorTrust = { trusted: true } | { trusted: false; reason: string };

/**
 * Whether an Evaluator version counts toward an Eval Run's verdict (D9).
 * `schema` is trusted on creation; `code` once a person approved its source;
 * `llm_judge` once calibrated against enough human labels. An untrusted
 * version still runs and writes Scores — the report shows it as not counted.
 */
export function evaluatorTrust(version: Pick<EvaluatorVersion, 'check' | 'sourceApproval' | 'calibration'>): EvaluatorTrust {
  switch (version.check.kind) {
    case 'schema':
      return { trusted: true };
    case 'code':
      return version.sourceApproval !== null
        ? { trusted: true }
        : { trusted: false, reason: 'source not approved' };
    case 'llm_judge': {
      const calibration = version.calibration;
      if (calibration === null) return { trusted: false, reason: 'not calibrated' };
      if (calibration.labelCount < JUDGE_MIN_LABELS) {
        return { trusted: false, reason: `calibrated on ${calibration.labelCount} labels, needs ${JUDGE_MIN_LABELS}` };
      }
      if (calibration.failureLabelCount < JUDGE_MIN_FAILURE_LABELS) {
        return { trusted: false, reason: `calibrated on ${calibration.failureLabelCount} failure labels, needs ${JUDGE_MIN_FAILURE_LABELS}` };
      }
      if (calibration.agreement < JUDGE_MIN_AGREEMENT) {
        return { trusted: false, reason: `agreement ${calibration.agreement.toFixed(2)} below ${JUDGE_MIN_AGREEMENT}` };
      }
      return { trusted: true };
    }
  }
}
