/**
 * Typed errors a handler may throw to signal a user-facing HTTP status other
 * than 500. The HTTP adapter catches instances of `HandlerError` and maps
 * them to `{ error: message }` with the declared `statusCode`; any other
 * thrown value is treated as an unexpected server error and sanitised to a
 * generic 500.
 *
 * Scope here is deliberately minimal — only the statuses we actually return
 * today (`404` for missing resources) get their own subclass. Add more
 * (409 for precondition failures, 403 for forbidden, …) when a handler
 * needs them; the error contract will grow alongside the mutations in
 * Phase 2 of the headless migration.
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
