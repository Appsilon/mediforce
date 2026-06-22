/**
 * PodLogStream — follows Kubernetes pod logs with reconnect-on-error and
 * timestamp-based deduplication.
 *
 * Design:
 *  - `readLogStream()` is a protected method that wraps the K8s Log class.
 *    Tests override it to inject a mock AsyncIterable, so no real network
 *    traffic occurs in the test suite.
 *  - `start()` consumes the AsyncIterable line-by-line. Each line is expected
 *    to be prefixed with an RFC3339Nano timestamp (K8s timestamps=true format):
 *      "2024-01-15T10:30:00.000000001Z some message"
 *    The timestamp is parsed and used as a dedup cursor.  Any line whose
 *    timestamp is <= lastTimestampSeen is silently dropped.
 *  - On stream error `start()` reopens the stream with
 *    `sinceSeconds = ceil((Date.now() - startedAt) / 1000)`.  The timestamp
 *    cursor handles overlap dedup.
 *  - After `maxRetries` consecutive errors with no progress the method throws.
 */

import { Writable } from 'node:stream';
import { Log } from '@kubernetes/client-node';
import type { CoreV1Api } from '@kubernetes/client-node';

// ─── Public types ─────────────────────────────────────────────────────────────

export interface LogStreamOptions {
  /** Maximum consecutive reconnect attempts before throwing (default: 5). */
  maxRetries?: number;
}

// ─── Timestamp parsing helpers ────────────────────────────────────────────────

/**
 * Splits a K8s timestamped log line into { timestamp, message }.
 * Returns null when the line doesn't start with an RFC3339/RFC3339Nano stamp.
 */
function parseTimestampedLine(
  line: string,
): { timestamp: Date; message: string } | null {
  // RFC3339 / RFC3339Nano: "2024-01-15T10:30:00.000000001Z rest of message"
  const spaceIdx = line.indexOf(' ');
  if (spaceIdx === -1) return null;
  const tsStr = line.slice(0, spaceIdx);
  const ts = new Date(tsStr);
  if (Number.isNaN(ts.getTime())) return null;
  return { timestamp: ts, message: line.slice(spaceIdx + 1) };
}

// ─── PodLogStream ─────────────────────────────────────────────────────────────

export class PodLogStream {
  private closed = false;
  private readonly maxRetries: number;

  /**
   * @param coreApi - Injected CoreV1Api (unused at runtime — kept for
   *   interface parity; the Log class is constructed from KubeConfig).
   *   Tests pass `undefined as never` to satisfy the type.
   * @param options - Optional tuning.
   */
  constructor(
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    protected readonly coreApi: CoreV1Api,
    options?: LogStreamOptions,
  ) {
    this.maxRetries = options?.maxRetries ?? 5;
  }

  // ─── Public interface ──────────────────────────────────────────────────────

  /**
   * Follows pod logs until the pod exits, the stream ends, or `close()` is
   * called.  Reconnects on stream errors up to `maxRetries` times.
   *
   * @param namespace  - K8s namespace.
   * @param podName    - Pod name.
   * @param onLine     - Callback invoked for each log line (timestamp stripped).
   */
  async start(
    namespace: string,
    podName: string,
    onLine: (line: string) => void,
  ): Promise<void> {
    const startedAt = Date.now();
    let lastTimestampSeen: Date | null = null;
    let consecutiveErrors = 0;

    while (!this.closed) {
      const sinceSeconds =
        consecutiveErrors > 0 || lastTimestampSeen !== null
          ? Math.ceil((Date.now() - startedAt) / 1000)
          : undefined;

      try {
        const iterable = this.readLogStream(namespace, podName, sinceSeconds);
        const iterator = iterable[Symbol.asyncIterator]();

        try {
          while (true) {
            // If closed BEFORE requesting the next value, terminate the iterator
            // immediately rather than blocking on the next yield.
            if (this.closed) {
              await iterator.return?.();
              return;
            }

            const result = await iterator.next();
            if (result.done) break;

            const rawLine = result.value;

            if (this.closed) {
              await iterator.return?.();
              return;
            }

            const parsed = parseTimestampedLine(rawLine);
            if (parsed === null) {
              // Non-timestamped line — deliver as-is (shouldn't happen normally)
              onLine(rawLine);
              continue;
            }

            // Dedup: skip lines at or before the cursor
            if (
              lastTimestampSeen !== null &&
              parsed.timestamp <= lastTimestampSeen
            ) {
              continue;
            }

            lastTimestampSeen = parsed.timestamp;
            onLine(parsed.message);

            // Check again after delivering — onLine may call close()
            if (this.closed) {
              await iterator.return?.();
              return;
            }
          }
        } catch (innerErr) {
          // Ensure iterator is cleaned up before propagating
          await iterator.return?.().catch(() => {});
          throw innerErr;
        }

        // Stream ended cleanly (pod exited) or was closed
        return;
      } catch (err) {
        consecutiveErrors++;
        if (consecutiveErrors >= this.maxRetries) {
          throw new Error(
            `PodLogStream: stream failed ${consecutiveErrors} consecutive time(s) for pod ${namespace}/${podName}: ${String(err)}`,
          );
        }
        // Loop: re-open with sinceSeconds on next iteration
      }
    }
  }

  /**
   * Signals the stream to stop after the current line.  Idempotent.
   * Any lines already in-flight that arrive after this call are dropped.
   */
  close(): void {
    this.closed = true;
  }

  // ─── Protected — override in tests ────────────────────────────────────────

  /**
   * Opens the K8s log stream and returns an AsyncIterable of raw lines
   * (each prefixed with an RFC3339 timestamp when `timestamps=true`).
   *
   * The default implementation uses `@kubernetes/client-node`'s `Log` class
   * piped through a passthrough stream + readline.  Tests override this to
   * inject programmable iterables.
   *
   * @param namespace    - K8s namespace.
   * @param podName      - Pod name.
   * @param sinceSeconds - If set, only return logs from the last N seconds.
   */
  protected readLogStream(
    namespace: string,
    podName: string,
    sinceSeconds?: number,
  ): AsyncIterable<string> {
    // Lazy-import the KubeConfig — avoids loading it in test environments
    // where `this.coreApi` is injected externally.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { KubeConfig } = require('@kubernetes/client-node') as typeof import('@kubernetes/client-node');

    const kc = new KubeConfig();
    if (process.env.KUBERNETES_SERVICE_HOST) kc.loadFromCluster();
    else kc.loadFromDefault();

    const logger = new Log(kc);
    return kubeLogToAsyncIterable(logger, namespace, podName, sinceSeconds);
  }
}

// ─── K8s Log → AsyncIterable adapter ─────────────────────────────────────────

/**
 * Wraps the K8s `Log.log()` call in an AsyncIterable<string> that emits one
 * string per complete log line.
 *
 * The `Log` class pipes raw bytes into a `Writable`.  We accumulate chunks,
 * split on newlines, and push complete lines into an async queue.  The
 * AbortController returned by `Log.log()` is used to abort the follow stream
 * when the consumer finishes iterating.
 */
async function* kubeLogToAsyncIterable(
  logger: Log,
  namespace: string,
  podName: string,
  sinceSeconds?: number,
): AsyncIterable<string> {
  const lines: string[] = [];
  const resolvers: Array<(value: void) => void> = [];
  let done = false;
  let streamError: Error | null = null;
  // Wrap the controller in an object so TypeScript's narrowing inside the
  // generator finally-block doesn't reduce the type to `never`.
  const controllerRef: { value: AbortController | null } = { value: null };

  const notify = () => {
    const resolve = resolvers.shift();
    if (resolve !== undefined) resolve();
  };

  let buffer = '';
  const writable = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      buffer += chunk.toString('utf8');
      const parts = buffer.split('\n');
      buffer = parts.pop() ?? '';
      for (const part of parts) {
        if (part.length > 0) {
          lines.push(part);
          notify();
        }
      }
      callback();
    },
    final(callback) {
      // Flush any remaining buffer
      if (buffer.length > 0) {
        lines.push(buffer);
        buffer = '';
        notify();
      }
      done = true;
      notify();
      callback();
    },
  });

  // Start the stream (non-blocking — we await in the generator below)
  logger
    .log(namespace, podName, /* container = */ '', writable, {
      follow: true,
      timestamps: true,
      ...(sinceSeconds !== undefined ? { sinceSeconds } : {}),
    })
    .then((controller) => {
      controllerRef.value = controller;
    })
    .catch((err: unknown) => {
      streamError = err instanceof Error ? err : new Error(String(err));
      done = true;
      notify();
    });

  try {
    while (true) {
      // Drain already-queued lines
      while (lines.length > 0) {
        yield lines.shift()!;
      }

      if (streamError !== null) throw streamError;
      if (done) break;

      // Wait for the next write / finish
      await new Promise<void>((resolve) => resolvers.push(resolve));
    }

    // Drain any final lines produced during the last notification
    while (lines.length > 0) {
      yield lines.shift()!;
    }
  } finally {
    // If the consumer exits early (e.g., close()), abort the HTTP stream
    controllerRef.value?.abort();
  }
}
