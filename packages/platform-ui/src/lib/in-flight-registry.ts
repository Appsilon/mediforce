// Shared registry of the agent/script step execution each running instance is
// currently driving in *this* process (ADR-0010 §4). Two independent modules
// read/write it:
//
//   - the auto-runner (`api/processes/[instanceId]/run/route.ts`) marks an
//     instance's current `StepExecution` in-flight while it awaits the plugin,
//     and clears it when the step finishes or the loop exits.
//   - the graceful-shutdown hook (`instrumentation.register()`) snapshots it on
//     SIGTERM and marks every in-flight execution `interrupted` before exit.
//
// Backed by `globalThis`, NOT a plain module-level `Map`: Next.js can bundle the
// instrumentation entry separately from the route handlers, which would give
// each its own copy of a module singleton — and then the shutdown hook would
// snapshot an always-empty map. A `globalThis`-keyed store is the one thing
// guaranteed shared across bundles in a single Node process.
//
// Single-process scope only, exactly like the `runLocks` guard next to it: with
// multiple `platform-ui` replicas each holds its own registry and marks only the
// runs it was driving. That is correct — a replica only receives SIGTERM for its
// own in-flight work.

const REGISTRY_KEY = Symbol.for('mediforce.inFlightStepExecutions');

type InFlightStore = Map<string, string>;

interface RegistryGlobal {
  [REGISTRY_KEY]?: InFlightStore;
}

function store(): InFlightStore {
  const g = globalThis as RegistryGlobal;
  if (g[REGISTRY_KEY] === undefined) {
    g[REGISTRY_KEY] = new Map<string, string>();
  }
  return g[REGISTRY_KEY];
}

/** Record that `instanceId`'s auto-runner is currently driving `executionId`. */
export function markStepInFlight(instanceId: string, executionId: string): void {
  store().set(instanceId, executionId);
}

/** Clear the in-flight execution for `instanceId` (step finished / loop exited). */
export function clearStepInFlight(instanceId: string): void {
  store().delete(instanceId);
}

/** Immutable `[instanceId, executionId]` snapshot for the shutdown hook. */
export function snapshotInFlight(): ReadonlyArray<readonly [string, string]> {
  return [...store().entries()];
}
