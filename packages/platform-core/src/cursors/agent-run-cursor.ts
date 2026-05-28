/**
 * Opaque cursor codec for `AgentRunRepository.list` / `.listInNamespaces`.
 *
 * Format: base64url(`${startedAt}|${id}`). The pair is the natural keyset
 * tie-breaker for the repo's sort order (startedAt DESC, id DESC) — same
 * encoding in-memory and Firestore so a cursor minted by one backend is
 * decodable by the other (matters for tests, matters for any future
 * read-replica swap).
 */
export function encodeAgentRunCursor(startedAt: string, id: string): string {
  return Buffer.from(`${startedAt}|${id}`, 'utf8').toString('base64url');
}

export function decodeAgentRunCursor(
  cursor: string,
): { startedAt: string; id: string } | null {
  try {
    const raw = Buffer.from(cursor, 'base64url').toString('utf8');
    const sep = raw.indexOf('|');
    if (sep < 0) return null;
    const startedAt = raw.slice(0, sep);
    const id = raw.slice(sep + 1);
    if (startedAt.length === 0 || id.length === 0) return null;
    return { startedAt, id };
  } catch {
    return null;
  }
}
