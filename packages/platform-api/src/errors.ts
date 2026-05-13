/**
 * Typed errors a handler may throw to signal a user-facing HTTP status other
 * than 500. The route adapter catches instances of `HandlerError` and maps
 * them to `{ error: message }` with the declared `statusCode`; any other
 * thrown value is treated as an unexpected server error and sanitised to a
 * generic 500.
 *
 * Scope grows as handlers need new statuses. Today: 403 (forbidden), 404
 * (not found). Add subclasses (409 precondition, 422 unprocessable, …) when
 * the first handler actually needs one.
 */
export class HandlerError extends Error {
  constructor(public readonly statusCode: number, message: string) {
    super(message);
    this.name = 'HandlerError';
  }
}

export class NotFoundError extends HandlerError {
  constructor(message = 'Not found') {
    super(404, message);
    this.name = 'NotFoundError';
  }
}

export class ForbiddenError extends HandlerError {
  constructor(message = 'Forbidden') {
    super(403, message);
    this.name = 'ForbiddenError';
  }
}
