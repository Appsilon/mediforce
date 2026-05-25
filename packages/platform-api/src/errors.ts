import { z } from 'zod';

// ADR-0005 typed errors. Closed union of error codes. Zod is the source of truth so both the
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

