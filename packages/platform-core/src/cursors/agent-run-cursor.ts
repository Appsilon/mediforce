import { z } from 'zod';
import { encodeCursor, decodeCursor } from './cursor.js';

/**
 * Cursor payload for `AgentRunRepository.list` / `.listInNamespaces`.
 *
 * Keyset tuple `(startedAt, id)` — the natural tie-breaker for the repo's
 * sort order (startedAt DESC, id DESC). Same payload in-memory and
 * Firestore so a cursor minted by one backend is decodable by the other
 * (matters for tests, matters for any future read-replica swap).
 */
const AgentRunCursorPayloadSchema = z.object({
  startedAt: z.string().min(1),
  id: z.string().min(1),
});

export type AgentRunCursorPayload = z.infer<typeof AgentRunCursorPayloadSchema>;

export function encodeAgentRunCursor(startedAt: string, id: string): string {
  return encodeCursor<AgentRunCursorPayload>({ startedAt, id });
}

export function decodeAgentRunCursor(cursor: string): AgentRunCursorPayload | null {
  return decodeCursor(cursor, AgentRunCursorPayloadSchema);
}
