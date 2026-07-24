import { describe, it, expect, afterEach } from 'vitest';
import {
  markStepInFlight,
  clearStepInFlight,
  snapshotInFlight,
} from '../in-flight-registry';

function reset(): void {
  for (const [instanceId] of snapshotInFlight()) {
    clearStepInFlight(instanceId);
  }
}

describe('in-flight step-execution registry', () => {
  afterEach(reset);

  it('records an in-flight execution and exposes it in the snapshot', () => {
    markStepInFlight('run-1', 'exec-1');
    expect(snapshotInFlight()).toEqual([['run-1', 'exec-1']]);
  });

  it('overwrites the entry when the run advances to a new execution', () => {
    markStepInFlight('run-1', 'exec-1');
    markStepInFlight('run-1', 'exec-2');
    expect(snapshotInFlight()).toEqual([['run-1', 'exec-2']]);
  });

  it('clears an entry when the step finishes', () => {
    markStepInFlight('run-1', 'exec-1');
    clearStepInFlight('run-1');
    expect(snapshotInFlight()).toEqual([]);
  });

  it('tracks multiple concurrent runs independently', () => {
    markStepInFlight('run-1', 'exec-1');
    markStepInFlight('run-2', 'exec-2');
    expect(new Map(snapshotInFlight())).toEqual(
      new Map([
        ['run-1', 'exec-1'],
        ['run-2', 'exec-2'],
      ]),
    );
  });

  it('returns a detached snapshot that later mutations do not change', () => {
    markStepInFlight('run-1', 'exec-1');
    const snapshot = snapshotInFlight();
    markStepInFlight('run-2', 'exec-2');
    expect(snapshot).toEqual([['run-1', 'exec-1']]);
  });
});
