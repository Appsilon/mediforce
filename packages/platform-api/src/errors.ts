/**
 * Typed errors a handler may throw to signal a user-facing HTTP status other
 * than 500. The HTTP adapter catches instances of `HandlerError` and maps
 * them to `{ error: message }` with the declared `statusCode`; any other
 * thrown value is treated as an unexpected server error and sanitised to a
 * generic 500.
 *
 * Phase 2 (mutations) widened the set: `ConflictError` for state-machine
 * refuses, `ForbiddenError` for auth policy at the handler boundary, and
 * `ValidationError` for domain-level input problems that are too rich for a
 * Zod `.refine()` (e.g. duplicate-config lookups, YAML parse failures).
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

export class ConflictError extends HandlerError {
  constructor(message = 'Conflict') {
    super(409, message);
    this.name = 'ConflictError';
  }
}

export class ForbiddenError extends HandlerError {
  constructor(message = 'Forbidden') {
    super(403, message);
    this.name = 'ForbiddenError';
  }
}

export class ValidationError extends HandlerError {
  constructor(message = 'Invalid input') {
    super(400, message);
    this.name = 'ValidationError';
  }
}
