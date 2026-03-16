import {
  evaluateExpression,
  ExpressionError,
  type ExpressionContext,
} from '../expressions/expression-evaluator.js';

// Re-export the context type so callers don't need to import from expressions
export type { ExpressionContext as TransitionContext };

export class TransitionValidationError extends Error {
  override name = 'TransitionValidationError';
}

export class NoMatchingTransitionError extends Error {
  override name = 'NoMatchingTransitionError';
}

export interface ResolvedTransition {
  to: string;
  reason: string;
}

/** Minimal transition shape — compatible with platform-core Transition. */
interface TransitionInput {
  from: string;
  to: string;
  when?: string;
}

/**
 * Evaluate all outgoing transitions and return every match.
 *
 * Rules:
 *  - 0 transitions → NoMatchingTransitionError
 *  - 1 transition without `when` → unconditional (always taken)
 *  - Multiple transitions → ALL must have `when` (validation error otherwise)
 *  - Engine evaluates every `when`; all that match are returned
 *  - `when: "true"` → always matches
 *  - `when: "else"` → matches only if no other transition matched
 *  - Multiple matches = parallel fork (caller decides how to handle)
 */
export function resolveTransitions(
  outgoingTransitions: TransitionInput[],
  context: ExpressionContext,
): ResolvedTransition[] {
  if (outgoingTransitions.length === 0) {
    throw new NoMatchingTransitionError(
      'No outgoing transitions from current step',
    );
  }

  // Single transition without `when` → unconditional
  if (outgoingTransitions.length === 1 && !outgoingTransitions[0].when) {
    return [
      { to: outgoingTransitions[0].to, reason: 'Unconditional transition' },
    ];
  }

  // Multiple transitions → all must have `when`
  if (outgoingTransitions.length > 1) {
    const missingWhen = outgoingTransitions.filter(
      (transition) => !transition.when,
    );
    if (missingWhen.length > 0) {
      throw new TransitionValidationError(
        `Multiple transitions require all to have 'when' conditions. ` +
          `Missing on transitions to: ${missingWhen.map((transition) => transition.to).join(', ')}`,
      );
    }
  }

  // Separate else transitions from normal ones
  const elseTransitions = outgoingTransitions.filter(
    (transition) => transition.when === 'else',
  );
  const normalTransitions = outgoingTransitions.filter(
    (transition) => transition.when !== 'else',
  );

  // Evaluate all normal transitions — collect every match
  const matched: ResolvedTransition[] = [];
  for (const transition of normalTransitions) {
    if (!transition.when) continue;
    try {
      if (evaluateExpression(transition.when, context)) {
        matched.push({
          to: transition.to,
          reason: `Matched: ${transition.when}`,
        });
      }
    } catch (error) {
      if (error instanceof ExpressionError) {
        throw new TransitionValidationError(
          `Error evaluating 'when: "${transition.when}"' on transition to "${transition.to}": ${error.message}`,
        );
      }
      throw error;
    }
  }

  // Fallback: if nothing matched, try else
  if (matched.length === 0 && elseTransitions.length > 0) {
    return [{ to: elseTransitions[0].to, reason: 'Default (else) transition' }];
  }

  if (matched.length === 0) {
    const evaluated = normalTransitions
      .map((transition) => transition.when)
      .join(', ');
    throw new NoMatchingTransitionError(
      `No matching transition. Evaluated: ${evaluated}`,
    );
  }

  return matched;
}
