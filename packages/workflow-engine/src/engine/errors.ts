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

/**
 * Thrown by `WorkflowEngine.completeHumanTask` when the supplied payload
 * fails per-variant validation against the task's runtime config — verdict
 * not in allowlist, missing required comment, file count out of range, etc.
 *
 * Distinct from `InvalidTransitionError` (state) and Zod parse errors
 * (shape) — this is the kind that needs the task's own data to detect, so
 * neither schema validation nor pure state checking covers it. The route
 * adapter maps it to HTTP 400 (validation).
 */
export class CompleteHumanTaskValidationError extends Error {
  override name = 'CompleteHumanTaskValidationError';

  constructor(
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
  }
}
