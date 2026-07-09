/**
 * Line-buffered reader for child process stdout/stderr streams.
 *
 * Child processes deliver data in arbitrary chunks — a single `data` event may
 * carry a partial line, multiple lines, or several lines plus a partial trailer.
 * This helper accumulates incoming bytes, splits on `\n`, and dispatches each
 * complete line to a callback as it arrives. The trailing partial chunk (if
 * any) is held until the next `data` event or the final flush.
 *
 * Lives in platform-core (zero-dep utility) so both `agent-runtime`
 * (LocalDockerSpawnStrategy, BaseContainerAgentPlugin.spawnLocalProcess) and
 * `container-worker` (worker-entry's docker-run loop) can share a single
 * implementation. Keeping the line-splitting in one place is the whole point —
 * any drift between agent-side and worker-side parsing is a parity bug.
 */

export interface LineStreamReader {
  /** Push a UTF-8 chunk into the buffer; emit any complete lines via the callback. */
  push(chunk: Buffer | string): void;
  /** Flush the trailing partial line (if any non-empty) via the callback. Call on stream close. */
  flush(): void;
}

/**
 * Build a line-buffered reader. Each complete line (without the trailing `\n`)
 * is passed to `onLine`. Empty lines are skipped — agents and containers
 * commonly emit blank lines for spacing and they carry no information.
 *
 * The reader does NOT trim whitespace from the line itself (apart from the
 * newline) — callers that need trimming can do it inside `onLine`.
 */
export function createLineStreamReader(onLine: (line: string) => void): LineStreamReader {
  let buffer = '';

  return {
    push(chunk: Buffer | string): void {
      buffer += typeof chunk === 'string' ? chunk : chunk.toString('utf-8');
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        if (line.length === 0) continue;
        onLine(line);
      }
    },
    flush(): void {
      const remaining = buffer;
      buffer = '';
      if (remaining.length > 0) {
        onLine(remaining);
      }
    },
  };
}
