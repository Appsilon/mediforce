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
