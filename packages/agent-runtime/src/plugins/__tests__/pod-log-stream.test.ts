/**
 * PodLogStream — reconnect + timestamp-dedup tests
 *
 * Architecture: PodLogStream exposes a protected `readLogStream()` method that
 * returns an AsyncIterable of raw timestamped lines (as K8s emits them when
 * timestamps=true).  Tests subclass and override that method — no real network
 * ever used.
 *
 * Line format coming from K8s with timestamps=true:
 *   "2024-01-15T10:30:00.000000001Z some log message"
 */

import { describe, it, expect, vi } from 'vitest';
import { PodLogStream, type LogStreamOptions } from '../pod-log-stream';

// ─── Test helper ─────────────────────────────────────────────────────────────

type StreamFactory = (sinceSeconds?: number) => AsyncIterable<string>;

/**
 * Creates a testable subclass that replaces the real K8s Log call with a
 * provided factory function.  Each call to `readLogStream` invokes `factory`
 * with the sinceSeconds argument so tests can verify reconnect params.
 */
function makeTestStream(factory: StreamFactory, options?: LogStreamOptions): PodLogStream {
  class TestPodLogStream extends PodLogStream {
    protected override readLogStream(
      _namespace: string,
      _podName: string,
      sinceSeconds?: number,
    ): AsyncIterable<string> {
      return factory(sinceSeconds);
    }
  }
  return new TestPodLogStream(undefined as never, options);
}

/** Builds a timestamped line as K8s emits it. */
function tsLine(isoTs: string, message: string): string {
  return `${isoTs} ${message}`;
}

/** Async generator that yields the given lines then finishes. */
async function* linesOf(...lines: string[]): AsyncIterable<string> {
  for (const line of lines) yield line;
}

/** Async generator that yields some lines then throws. */
async function* linesWithError(lines: string[], error: Error): AsyncIterable<string> {
  for (const line of lines) yield line;
  throw error;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

const NS = 'default';
const POD = 'my-pod-abc';

const T1 = '2024-01-15T10:30:00.000000001Z';
const T2 = '2024-01-15T10:30:01.000000000Z';
const T3 = '2024-01-15T10:30:02.000000000Z';

describe('PodLogStream', () => {
  // ── Case 1: basic delivery ──────────────────────────────────────────────────
  it('delivers each timestamped line (without the timestamp prefix) to onLine', async () => {
    const received: string[] = [];
    const stream = makeTestStream(() =>
      linesOf(
        tsLine(T1, 'hello world'),
        tsLine(T2, 'second line'),
        tsLine(T3, 'third line'),
      ),
    );

    await stream.start(NS, POD, (line) => received.push(line));

    expect(received).toEqual(['hello world', 'second line', 'third line']);
  });

  // ── Case 2: reconnect on error with sinceSeconds ────────────────────────────
  it('retries with sinceSeconds on stream error and delivers lines from the reconnect', async () => {
    const received: string[] = [];
    const callArgs: Array<number | undefined> = [];

    let callCount = 0;
    const factory: StreamFactory = (sinceSeconds) => {
      callArgs.push(sinceSeconds);
      callCount++;
      if (callCount === 1) {
        // First call: yield one line then throw
        return linesWithError([tsLine(T1, 'before-error')], new Error('ProtocolError'));
      }
      // Second call (reconnect): clean stream
      return linesOf(tsLine(T2, 'after-reconnect'));
    };

    const stream = makeTestStream(factory, { maxRetries: 3 });
    await stream.start(NS, POD, (line) => received.push(line));

    // First call has no sinceSeconds (fresh start)
    expect(callArgs[0]).toBeUndefined();
    // Second call must include sinceSeconds >= 0
    expect(typeof callArgs[1]).toBe('number');
    expect(callArgs[1]).toBeGreaterThanOrEqual(0);

    expect(received).toEqual(['before-error', 'after-reconnect']);
  });

  // ── Case 3: timestamp-based dedup across reconnects ─────────────────────────
  it('drops duplicate lines (same or earlier timestamp) emitted across reconnects', async () => {
    const received: string[] = [];

    let callCount = 0;
    const factory: StreamFactory = () => {
      callCount++;
      if (callCount === 1) {
        // Error after T1 and T2
        return linesWithError(
          [tsLine(T1, 'line-a'), tsLine(T2, 'line-b')],
          new Error('ConnectionReset'),
        );
      }
      // Reconnect overlaps: re-emits T1, T2 then adds T3
      return linesOf(tsLine(T1, 'line-a'), tsLine(T2, 'line-b'), tsLine(T3, 'line-c'));
    };

    const stream = makeTestStream(factory, { maxRetries: 3 });
    await stream.start(NS, POD, (line) => received.push(line));

    // T1/T2 duplicates dropped; only T3 new line from reconnect
    expect(received).toEqual(['line-a', 'line-b', 'line-c']);
  });

  // ── Case 4: close() resolves start() cleanly ────────────────────────────────
  it('close() causes start() to resolve without delivering further lines', async () => {
    const received: string[] = [];

    // Infinite stream that yields one line, then pauses (simulated via a never-
    // resolving promise).
    async function* infiniteStream(): AsyncIterable<string> {
      yield tsLine(T1, 'first-line');
      // Never yields again — simulate a hanging follow stream
      await new Promise<never>(() => {});
    }

    const stream = makeTestStream(() => infiniteStream());

    // Start and close after first line
    let resolved = false;
    const done = stream.start(NS, POD, (line) => {
      received.push(line);
      // Close on receipt of the first line
      stream.close();
    }).then(() => {
      resolved = true;
    });

    await done;
    expect(resolved).toBe(true);
    expect(received).toEqual(['first-line']);
  });

  // ── Case 5: no late lines after close() ─────────────────────────────────────
  it('lines arriving after close() are dropped and do not invoke onLine', async () => {
    const received: string[] = [];
    let closedMidStream = false;

    async function* streamWithLateLines(): AsyncIterable<string> {
      yield tsLine(T1, 'delivered');
      // Simulate close happening between yields — checked via the flag
      closedMidStream = true;
      yield tsLine(T2, 'should-be-dropped');
      yield tsLine(T3, 'also-dropped');
    }

    const stream = makeTestStream(() => streamWithLateLines());

    await stream.start(NS, POD, (line) => {
      received.push(line);
      if (closedMidStream) {
        // This line arrived after the internal close, should not have been delivered
        received.push('__unexpected__');
      }
    });

    // We need to close the stream before the late lines arrive.
    // Test approach: close inside onLine after the first delivery.
    received.length = 0;

    const stream2 = makeTestStream(() => streamWithLateLines());
    await stream2.start(NS, POD, (line) => {
      received.push(line);
      stream2.close(); // close after first line
    });

    expect(received).toEqual(['delivered']);
  });

  // ── Case 6: exhausted retries throws ───────────────────────────────────────
  it('throws after exceeding maxRetries consecutive errors', async () => {
    const factory: StreamFactory = () =>
      linesWithError([], new Error('persistent-error'));

    const stream = makeTestStream(factory, { maxRetries: 3 });

    await expect(stream.start(NS, POD, () => {})).rejects.toThrow();
  });
});
