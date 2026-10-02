import type { EvaluatorVersion } from '../schemas/evaluation';

export type EvaluatorTrust = { trusted: true } | { trusted: false; reason: string };

/**
 * Whether an Evaluator version counts toward an Eval Run's verdict (D9).
 * `schema`, `llm_judge` and `expected_output` are trusted on creation — a
 * judge's verdicts are gated one by one, by its `minConfidence` and a
 * person's review; `code` once a person approved its source. An untrusted version still runs and writes
 * Scores — the report shows it as not counted.
 */
export function evaluatorTrust(version: Pick<EvaluatorVersion, 'check' | 'sourceApproval'>): EvaluatorTrust {
  switch (version.check.kind) {
    case 'schema':
    case 'llm_judge':
    case 'expected_output':
      return { trusted: true };
    case 'code':
      return version.sourceApproval !== null
        ? { trusted: true }
        : { trusted: false, reason: 'source not approved' };
  }
}
