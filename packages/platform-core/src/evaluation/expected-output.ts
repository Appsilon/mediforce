import type { EvalCase, EvaluatorKind } from '../schemas/evaluation';
import { canonicalJson } from './canonical-json';

/**
 * Whether an Evaluator grades a case: the case selects it (or selects none, so
 * every Evaluator grades it), and an `expected_output` check only grades a
 * case that has an expected output.
 */
export function evaluatorAppliesToCase(
  evaluator: { readonly evaluatorId: string; readonly kind: EvaluatorKind },
  evalCase: Pick<EvalCase, 'evaluatorIds' | 'expectedOutput'>,
): boolean {
  if (evalCase.evaluatorIds !== null && evalCase.evaluatorIds.includes(evaluator.evaluatorId) === false) return false;
  return evaluator.kind !== 'expected_output' || evalCase.expectedOutput !== null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && Array.isArray(value) === false;
}

function pathLabel(path: readonly string[]): string {
  return path.length === 0 ? '(the whole output)' : path.join('.');
}

/**
 * Where an output differs from an expected output, as dotted paths, at most
 * `limit` of them. Object key order is ignored; array order is not.
 */
export function outputDifferences(expected: unknown, actual: unknown, limit = 10): string[] {
  const found: string[] = [];
  const walk = (left: unknown, right: unknown, path: string[]) => {
    if (found.length >= limit) return;
    if (isRecord(left) && isRecord(right)) {
      for (const key of [...new Set([...Object.keys(left), ...Object.keys(right)])].sort()) {
        if ((key in left) === false) found.push(`${pathLabel([...path, key])}: not expected`);
        else if ((key in right) === false) found.push(`${pathLabel([...path, key])}: missing`);
        else walk(left[key], right[key], [...path, key]);
        if (found.length >= limit) return;
      }
      return;
    }
    if (Array.isArray(left) && Array.isArray(right) && left.length === right.length) {
      left.forEach((item, index) => walk(item, right[index], [...path, String(index)]));
      return;
    }
    if (canonicalJson(left) !== canonicalJson(right)) {
      found.push(`${pathLabel(path)}: expected ${truncated(left)}, got ${truncated(right)}`);
    }
  };
  walk(expected, actual, []);
  return found;
}

function truncated(value: unknown): string {
  const text = JSON.stringify(value) ?? 'undefined';
  return text.length > 80 ? `${text.slice(0, 80)}…` : text;
}
