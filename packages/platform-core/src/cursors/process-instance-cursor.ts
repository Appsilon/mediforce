import { z } from 'zod';
import { encodeCursor, decodeCursor } from './cursor';

/**
 * Cursor payload for `ProcessInstanceRepository.listPage` /
 * `.listPageInNamespaces`.
 *
 * Keyset tuple `(createdAt, id)` — the natural tie-breaker for the repo's
 * sort order (createdAt DESC, id DESC). Same shape as `AgentRunCursorPayload`
 * (see `agent-run-cursor.ts`), just keyed on a different timestamp column.
 */
const ProcessInstanceCursorPayloadSchema = z.object({
  createdAt: z.string().min(1),
  id: z.string().min(1),
});

export type ProcessInstanceCursorPayload = z.infer<typeof ProcessInstanceCursorPayloadSchema>;

export function encodeProcessInstanceCursor(createdAt: string, id: string): string {
  return encodeCursor<ProcessInstanceCursorPayload>({ createdAt, id });
}

export function decodeProcessInstanceCursor(cursor: string): ProcessInstanceCursorPayload | null {
  return decodeCursor(cursor, ProcessInstanceCursorPayloadSchema);
}
