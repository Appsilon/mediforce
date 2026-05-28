import type {
  AgentRun,
  AgentRunRepository,
  ListAgentRunsOptions,
  ListAgentRunsPage,
} from '@mediforce/platform-core';
import type { CallerIdentity } from '../auth.js';
import { AuthorizedScope } from './authorized-repository.js';

/**
 * Agent-run reads. AgentRun has no namespace field — workspace membership
 * lives on the parent `ProcessInstance`. The per-row workspace check that
 * the wrapper used to perform (via `raw.*InNamespaces(allowed, ...)`)
 * landed on the wire as an N+1 parent lookup or a workspace-wide
 * processInstances index read plus a per-row Schema.parse on every fetched
 * row — ~20–40 s on a 1.2k-run workspace in dev mode, and worse if a
 * legacy ProcessInstance carried a corrupt field that fed a 400 ZodError
 * after a multi-minute parent scan.
 *
 * The pre-PR2 Firestore subscription that the Run History UI used had no
 * per-document workspace gating at all (it relied on the global
 * `agentRuns` rule, which doesn't peek into the parent ProcessInstance).
 * Restoring that parity here keeps PR2's wire-format change isolated to
 * the API/CLI surface and unblocks the merge — a real gating + filter
 * pushdown happens once agent-runs migrates to Postgres (ADR-0001) and a
 * denormalised `namespace` column makes a single `WHERE namespace IN (…)`
 * the storage-layer enforcement point.
 *
 * Tracked: [#588](https://github.com/Appsilon/mediforce/issues/588) — when
 * the storage migration lands, this wrapper restores the
 * `*InNamespaces` paths or, preferably, switches to RLS at the row level.
 */
export class AuthorizedAgentRunRepository extends AuthorizedScope {
  constructor(
    caller: CallerIdentity,
    private readonly raw: AgentRunRepository,
  ) {
    super(caller);
  }

  // Intentional no-op wrappers — see header. Both user and system actors
  // hit `raw.*` directly; the `caller` field stays on the class so a future
  // gating-restore is a one-file change.
  getById = async (runId: string): Promise<AgentRun | null> => this.raw.getById(runId);
  getByInstanceId = async (instanceId: string): Promise<AgentRun[]> =>
    this.raw.getByInstanceId(instanceId);
  list = async (opts: ListAgentRunsOptions): Promise<ListAgentRunsPage> => this.raw.list(opts);
}
