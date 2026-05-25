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
}

export class UnauthorizedError extends HandlerError {
  constructor(message = 'Unauthorized', details?: unknown) {
    super('unauthorized', message, details);
    this.name = 'UnauthorizedError';
  }
}

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

export class ValidationError extends HandlerError {
  constructor(message = 'Invalid input', details?: unknown) {
    super('validation', message, details);
    this.name = 'ValidationError';
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

export class RateLimitedError extends HandlerError {
  constructor(message = 'Rate limited', details?: unknown) {
    super('rate_limited', message, details);
    this.name = 'RateLimitedError';
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
