import { z } from 'zod';
import { encodeCursor, decodeCursor } from './cursor';

/**
 * Cursor payload for `ProcessInstanceRepository.listPage` /
 * `.listPageInNamespaces`.
 *
 * Carries the active order and its complete keyset tuple. `createdAt`/`id`
 * remain deterministic tie-breakers for cost ordering; unknown costs sort
 * after known costs regardless of direction.
 */
const ProcessInstanceCursorPayloadSchema = z.object({
  sort: z.enum(['createdAt', 'cost']).default('createdAt'),
  direction: z.enum(['asc', 'desc']).default('desc'),
  createdAt: z.string().min(1),
  id: z.string().min(1),
  totalCostUsd: z.number().nullable().optional(),
});

export type ProcessInstanceCursorPayload = z.infer<typeof ProcessInstanceCursorPayloadSchema>;

export function encodeProcessInstanceCursor(payload: ProcessInstanceCursorPayload): string {
  return encodeCursor<ProcessInstanceCursorPayload>(payload);
}

export function decodeProcessInstanceCursor(cursor: string): ProcessInstanceCursorPayload | null {
  return decodeCursor(cursor, ProcessInstanceCursorPayloadSchema);
}
