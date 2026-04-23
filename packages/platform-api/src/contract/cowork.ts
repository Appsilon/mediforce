import { z } from 'zod';
import { CoworkSessionSchema } from '@mediforce/platform-core';

/**
 * Contracts for the `cowork` domain (read endpoints).
 *
 * Single-resource reads — the output is `CoworkSessionSchema` bare (no
 * wrapper), matching the pattern set by `GET /api/tasks/:taskId`. Missing
 * sessions surface as `NotFoundError` from the handler and are mapped to
 * HTTP 404 by the route adapter.
 */

// ---- GET /api/cowork/:sessionId ---------------------------------------------

export const GetCoworkSessionInputSchema = z.object({
  sessionId: z.string().min(1),
});

export const GetCoworkSessionOutputSchema = CoworkSessionSchema;

export type GetCoworkSessionInput = z.infer<typeof GetCoworkSessionInputSchema>;
export type GetCoworkSessionOutput = z.infer<typeof GetCoworkSessionOutputSchema>;

// ---- GET /api/cowork/by-instance/:instanceId --------------------------------
//
// Returns the most recent *active* cowork session for a process instance.
// Missing → 404 (same shape as the pre-migration route). Output is the same
// `CoworkSessionSchema` — callers that already handle sessions get one.

export const GetCoworkSessionByInstanceInputSchema = z.object({
  instanceId: z.string().min(1),
});

export const GetCoworkSessionByInstanceOutputSchema = CoworkSessionSchema;

export type GetCoworkSessionByInstanceInput = z.infer<
  typeof GetCoworkSessionByInstanceInputSchema
>;
export type GetCoworkSessionByInstanceOutput = z.infer<
  typeof GetCoworkSessionByInstanceOutputSchema
>;
