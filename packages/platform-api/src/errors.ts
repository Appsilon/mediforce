import { z } from 'zod';

// ADR-0005 typed errors. `ApiError` is preferred for new handlers; the
// `HandlerError` family stays as a coexistence bridge for Phase 1 throw sites.
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

export class ApiError extends Error {
  constructor(
    public readonly code: ApiErrorCode,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
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

export function apiErrorCodeForStatus(statusCode: number): ApiErrorCode {
  switch (statusCode) {
    case 400:
      return 'validation';
    case 401:
      return 'unauthorized';
    case 403:
      return 'forbidden';
    case 404:
      return 'not_found';
    case 409:
      return 'precondition_failed';
    case 429:
      return 'rate_limited';
    default:
      return 'internal';
  }
}
