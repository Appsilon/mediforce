import { z } from 'zod';

// Closed union of error codes. Zod is the source of truth so both the
// adapter (output) and the client (input) parse against the same enum.
export const ApiErrorCodeSchema = z.enum([
  'unauthorized',
  'forbidden',
  'not_found',
  'validation',
  'precondition_failed',
  'conflict',
  'rate_limited',
  'internal',
]);
export type ApiErrorCode = z.infer<typeof ApiErrorCodeSchema>;

// Envelope schemas — single source of truth for the wire shape.
// Note: the `code` field is `z.string()` (not `ApiErrorCodeSchema`) on
// purpose. We want graceful version drift: a v1 client must still parse
// an envelope from a v2 server that introduced a new code. The client
// casts to `ApiErrorCode` at the boundary (see `extractErrorEnvelope`).
export const TypedApiErrorEnvelopeSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});
export const LegacyApiErrorEnvelopeSchema = z.object({
  error: z.string(),
});
export const ApiErrorEnvelopeSchema = z.union([
  TypedApiErrorEnvelopeSchema,
  LegacyApiErrorEnvelopeSchema,
]);

// ADR-0005 typed errors (PR1.1-alt: single hierarchy). `HandlerError`
// is the only throwable; subclasses give type-narrowed throw sites and
// IDE autocomplete at zero wire cost (the envelope is the same single
// shape regardless of subclass).
export class HandlerError extends Error {
  constructor(
    public readonly code: ApiErrorCode,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'HandlerError';
  }

  get statusCode(): number {
    return httpStatusForApiErrorCode(this.code);
  }

  // Plain object for JSON serialization — framework-free, so the adapter
  // (which knows about NextResponse) can `NextResponse.json(err.toEnvelope(),
  // { status: err.statusCode })` in one line. Mirrors Hono's HTTPException
  // and NestJS's HttpException patterns: the throwable knows its wire shape.
  toEnvelope(): z.infer<typeof TypedApiErrorEnvelopeSchema> {
    const envelope: z.infer<typeof TypedApiErrorEnvelopeSchema> = {
      error: { code: this.code, message: this.message },
    };
    if (this.details !== undefined) envelope.error.details = this.details;
    return envelope;
  }
}

// Only the codes actually thrown in product code today get a subclass.
// Other codes in `ApiErrorCode` (unauthorized, validation, conflict,
// rate_limited) throw via the base `HandlerError` until the first
// real throw site lands, at which point that code's subclass is added.
// `internal` has no subclass on purpose — the adapter emits it for any
// uncaught non-HandlerError (handlers don't throw it deliberately).
export class ForbiddenError extends HandlerError {
  constructor(message = 'Forbidden', details?: unknown) {
    super('forbidden', message, details);
    this.name = 'ForbiddenError';
  }
}

export class NotFoundError extends HandlerError {
  constructor(message = 'Not found', details?: unknown) {
    super('not_found', message, details);
    this.name = 'NotFoundError';
  }
}

export class PreconditionFailedError extends HandlerError {
  constructor(message = 'Precondition failed', details?: unknown) {
    super('precondition_failed', message, details);
    this.name = 'PreconditionFailedError';
  }
}

export class ConflictError extends HandlerError {
  constructor(message = 'Conflict', details?: unknown) {
    super('conflict', message, details);
    this.name = 'ConflictError';
  }
}

export class ValidationError extends HandlerError {
  constructor(message = 'Invalid input', details?: unknown) {
    super('validation', message, details);
    this.name = 'ValidationError';
  }
}

export function httpStatusForApiErrorCode(code: ApiErrorCode): number {
  switch (code) {
    case 'unauthorized':
      return 401;
    case 'forbidden':
      return 403;
    case 'not_found':
      return 404;
    case 'validation':
      return 400;
    case 'precondition_failed':
      return 409;
    case 'conflict':
      return 409;
    case 'rate_limited':
      return 429;
    case 'internal':
      return 500;
  }
}
