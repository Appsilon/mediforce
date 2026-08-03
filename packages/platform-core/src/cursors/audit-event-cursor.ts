import { z } from 'zod';
import { encodeCursor, decodeCursor } from './cursor';

/**
 * Cursor payload for `AuditRepository.getByNamespace`'s paginated read.
 *
 * Keyset tuple `(timestamp, id)` — same shape as the other two domains'
 * cursors (`agent-run-cursor.ts`, `process-instance-cursor.ts`). `id` is
 * required here (unlike `AuditEvent.id` being optional on the schema)
 * because a cursor minted from a row that somehow lacks an id would be
 * unusable as a tie-breaker — see `AuditEventSchema`'s docstring on `id`.
 */
const AuditEventCursorPayloadSchema = z.object({
  timestamp: z.string().min(1),
  id: z.string().min(1),
});

export type AuditEventCursorPayload = z.infer<typeof AuditEventCursorPayloadSchema>;

export function encodeAuditEventCursor(timestamp: string, id: string): string {
  return encodeCursor<AuditEventCursorPayload>({ timestamp, id });
}

export function decodeAuditEventCursor(cursor: string): AuditEventCursorPayload | null {
  return decodeCursor(cursor, AuditEventCursorPayloadSchema);
}
