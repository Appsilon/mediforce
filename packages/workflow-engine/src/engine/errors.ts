export class StepFailureError extends Error {
  override name = 'StepFailureError';

  constructor(
    public readonly stepId: string,
    message: string,
  ) {
    super(message);
  }
}

export class RoutingError extends Error {
  override name = 'RoutingError';

  constructor(
    public readonly stepId: string,
    message: string,
  ) {
    super(message);
  }
}

export class InvalidTransitionError extends Error {
  override name = 'InvalidTransitionError';

  constructor(
    public readonly fromStatus: string,
    public readonly operation: string,
  ) {
    super(`Cannot perform '${operation}' on instance with status '${fromStatus}'`);
  }
}

export class MaxIterationsExceededError extends Error {
  override name = 'MaxIterationsExceededError';

  constructor(
    public readonly stepId: string,
    public readonly limit: number,
  ) {
    super(`Step '${stepId}' exceeded max iterations limit of ${limit}`);
  }
}

// Per-variant payload validation failure that needs the task's runtime
// config to detect (verdict allowlist, requiresComment, file constraints).
// Distinct from InvalidTransitionError (state) and Zod parse errors (shape).
export class CompleteHumanTaskValidationError extends Error {
  override name = 'CompleteHumanTaskValidationError';

  constructor(
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
  }
}

// Typed so handlers can instanceof-check instead of string-matching err.message.
export class ParentInstanceNotFoundError extends Error {
  override name = 'ParentInstanceNotFoundError';

  constructor(public readonly instanceId: string) {
    super(`Process instance '${instanceId}' not found`);
  }
}
