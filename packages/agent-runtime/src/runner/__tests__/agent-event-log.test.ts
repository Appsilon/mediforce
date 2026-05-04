import { describe, it, expect } from 'vitest';
import type { Firestore } from 'firebase-admin/firestore';
import type { AgentEvent } from '@mediforce/platform-core';
import { FirestoreAgentEventLog } from '../agent-event-log.js';

/**
 * Tiny in-memory Firestore stub that simulates an asynchronous `.set()` write.
 * The artificial delay makes concurrent `write()` calls overlap, exposing any
 * race in sequence-number assignment.
 */
function buildSlowFirestoreStub(writeDelayMs: number): { db: Firestore; written: AgentEvent[] } {
  const written: AgentEvent[] = [];
  const db = {
    collection: () => ({
      doc: () => ({
        collection: () => ({
          doc: () => ({
            set: async (event: AgentEvent) => {
              await new Promise((r) => setTimeout(r, writeDelayMs));
              written.push(event);
            },
          }),
        }),
      }),
    }),
  } as unknown as Firestore;
  return { db, written };
}

describe('FirestoreAgentEventLog', () => {
  it('[DATA] assigns monotonically increasing sequence numbers under concurrent writes', async () => {
    // Simulate 50 concurrent emits — pre-fix this would race on `existing.length` and
    // produce duplicate sequence values. Post-fix the per-step chain serializes them.
    const { db, written } = buildSlowFirestoreStub(2);
    const log = new FirestoreAgentEventLog(db);

    const N = 50;
    const writes = Array.from({ length: N }, (_, i) =>
      log.write('inst-1', 'step-1', {
        type: 'assistant',
        payload: `event-${i}`,
        timestamp: new Date().toISOString(),
      }),
    );
    await Promise.all(writes);

    expect(written).toHaveLength(N);
    const sequences = written.map((e) => e.sequence).sort((a, b) => a - b);
    expect(sequences).toEqual(Array.from({ length: N }, (_, i) => i));
  });

  it('[DATA] keeps per-(instance,step) chains independent so different steps do not block each other', async () => {
    const { db, written } = buildSlowFirestoreStub(2);
    const log = new FirestoreAgentEventLog(db);

    await Promise.all([
      log.write('inst-1', 'step-A', { type: 'status', payload: 'a1', timestamp: '' }),
      log.write('inst-1', 'step-B', { type: 'status', payload: 'b1', timestamp: '' }),
      log.write('inst-1', 'step-A', { type: 'status', payload: 'a2', timestamp: '' }),
      log.write('inst-1', 'step-B', { type: 'status', payload: 'b2', timestamp: '' }),
    ]);

    const aSeqs = written.filter((e) => e.stepId === 'step-A').map((e) => e.sequence);
    const bSeqs = written.filter((e) => e.stepId === 'step-B').map((e) => e.sequence);
    expect(aSeqs.sort()).toEqual([0, 1]);
    expect(bSeqs.sort()).toEqual([0, 1]);
  });

  it('[DATA] a failed write does not poison the chain for subsequent writes', async () => {
    const written: AgentEvent[] = [];
    let callCount = 0;
    const db = {
      collection: () => ({
        doc: () => ({
          collection: () => ({
            doc: () => ({
              set: async (event: AgentEvent) => {
                callCount += 1;
                if (callCount === 1) {
                  throw new Error('simulated firestore failure');
                }
                written.push(event);
              },
            }),
          }),
        }),
      }),
    } as unknown as Firestore;
    const log = new FirestoreAgentEventLog(db);

    const failing = log.write('i', 's', { type: 'status', payload: 'fail', timestamp: '' });
    await expect(failing).rejects.toThrow('simulated firestore failure');

    // Subsequent writes must still succeed and keep monotonic sequence.
    await log.write('i', 's', { type: 'status', payload: 'ok-1', timestamp: '' });
    await log.write('i', 's', { type: 'status', payload: 'ok-2', timestamp: '' });

    expect(written.map((e) => e.sequence)).toEqual([0, 1]);
  });

  it('[DATA] awaiting the last write also waits for in-flight earlier writes (final result lands last)', async () => {
    // ScriptContainerPlugin issues fire-and-forget activity emits, then awaits the result
    // emit. Per-step serialization guarantees the result arrives after every preceding
    // activity event has been written.
    const { db, written } = buildSlowFirestoreStub(5);
    const log = new FirestoreAgentEventLog(db);

    log.write('i', 's', { type: 'assistant', payload: 'line-1', timestamp: '' }).catch(() => {});
    log.write('i', 's', { type: 'assistant', payload: 'line-2', timestamp: '' }).catch(() => {});
    log.write('i', 's', { type: 'assistant', payload: 'line-3', timestamp: '' }).catch(() => {});
    await log.write('i', 's', { type: 'result', payload: 'final', timestamp: '' });

    expect(written.map((e) => e.payload)).toEqual(['line-1', 'line-2', 'line-3', 'final']);
    expect(written.map((e) => e.sequence)).toEqual([0, 1, 2, 3]);
  });
});
