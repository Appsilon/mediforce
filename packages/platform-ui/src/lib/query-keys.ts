import type { HumanTaskStatus } from '@mediforce/platform-core';

/**
 * Cache key factories per ADR-0006 §2.
 *
 * Convention: `[domain, scopeKey?, ...filters]` — string-prefix-first arrays
 * so `qc.invalidateQueries({ queryKey: queryKeys.tasks.all() })` catches
 * every variant under the prefix. Plain values for top-level filters; object
 * literal at the tail when the filter set has multiple fields.
 *
 * Convention for the singular detail key: lives under a distinct domain
 * (`'task'`, `'run'`, `'agent-run'`) so list-prefix invalidation of
 * `['tasks']` / `['runs']` / `['agent-runs']` does not clobber the detail
 * cache. Detail and list are different surfaces.
 *
 * Currently covers tasks, runs / processes / audit, cowork, users (`me`),
 * namespace (detail), agent-runs, monitoring. Future work extends with
 * `workflows`.
 */
export const queryKeys = {
  tasks: {
    /** Prefix matcher — `['tasks']` invalidates every list slice. */
    all: () => ['tasks'] as const,
    /** All tasks for a process instance, optionally narrowed by stepId. */
    byInstance: (instanceId: string, filters?: { stepId?: string; status?: HumanTaskStatus[] }) =>
      ['tasks', { instanceId, ...filters }] as const,
    /** All tasks for a role, optionally narrowed by status. */
    byRole: (role: string, filters?: { status?: HumanTaskStatus[] }) =>
      ['tasks', { role, ...filters }] as const,
    /** Every task in a workspace, optionally narrowed by status. */
    byNamespace: (namespace: string, filters?: { status?: HumanTaskStatus[] }) =>
      ['tasks', { namespace, ...filters }] as const,
    /** Caller-scope axis: every task visible to the caller across roles + instances. */
    forCaller: (filters?: { status?: HumanTaskStatus[] }) =>
      ['tasks', { caller: 'me', ...filters }] as const,
  },
  task: (taskId: string) => ['task', taskId] as const,

  runs: {
    /** Prefix matcher — `['runs']` invalidates every list slice (including
     *  the name-map projection). Intentional: any run-set change should
     *  refresh display-name lookups in the next tick. */
    all: () => ['runs'] as const,
    /** Workspace-scoped `id → definitionName` map. Lives under the `runs`
     *  prefix so mutation-driven invalidations refresh labels without per-site
     *  wiring; keyed by handle so two workspaces don't share a cache entry. */
    nameMap: (handle: string) => ['runs', 'name-map', handle] as const,
    /** Keyset-paginated run list (Monitoring → Workflows, `/runs`). */
    page: (
      handle: string,
      filters: {
        workflow?: string;
        dryRun?: boolean;
        archived?: boolean;
        displayStatus?: string;
        sort?: 'started' | 'cost';
        direction?: 'asc' | 'desc';
      },
    ) => ['runs', 'page', handle, { ...filters }] as const,
    /** Grouped WorkflowDisplayStatus counts backing the Workflows tab's KPI
     *  cards — same filter shape as `page` minus `displayStatus` itself. */
    statusCounts: (
      handle: string,
      filters: { workflow?: string; dryRun?: boolean; archived?: boolean },
    ) => ['runs', 'status-counts', handle, { ...filters }] as const,
  },
  run: (runId: string) => ['run', runId] as const,

  /** Audit-trail key, scoped per run. List domain so consumers can tag-prefix
   *  invalidate `['audit']` across every detail page if needed. */
  audit: (runId: string) => ['audit', runId] as const,

  /** Workflow definition lookup — scoped by workspace handle + definition
   *  name + version. Version `undefined` is the "latest" lookup. */
  workflow: (handle: string, name: string, version: number | undefined) =>
    ['workflow', handle, name, version ?? 'latest'] as const,

  /** Version metadata list for a workflow in a namespace (workflows.versions). */
  workflowVersions: (namespace: string, name: string) =>
    ['workflow-versions', namespace, name] as const,

  /** Live trigger rows for a workflow (triggers.list), reflecting the unified
   *  `triggers` table's enabled/schedule state (ADR-0011). */
  workflowTriggers: (namespace: string, name: string) =>
    ['workflow-triggers', namespace, name] as const,

  /** Aggregate step-entry view for a process instance (processes.getSteps). */
  processSteps: (instanceId: string) => ['process-steps', instanceId] as const,

  /** Output Files listing for a run (runs.listOutputFiles). */
  runOutputFiles: (runId: string) => ['run-output-files', runId] as const,

  /** Agent event log slice. `stepId` undefined fetches every step's events
   *  on the instance. */
  agentEvents: (instanceId: string, stepId: string | null | undefined) =>
    ['agent-events', instanceId, stepId ?? null] as const,

  cowork: {
    /** Session metadata key (status, artifact, model, voice config). */
    session: (sessionId: string) => ['cowork', sessionId] as const,
    /** Conversation turns key — separate cache surface from session
     * metadata so chat-mutation optimistic prepends operate on a focused
     * scope without invalidating session metadata. */
    turns: (sessionId: string) => ['cowork', sessionId, 'turns'] as const,
    /** Lookup by parent process instance — at most one session per instance.
     * Object-discriminated so it doesn't collide with `['cowork', sessionId]`
     * under prefix invalidation. */
    byInstance: (instanceId: string) => ['cowork', { byInstance: instanceId }] as const,
  },
  /**
   * Identity + memberships bundle. ONE-SHOT, `refetchOnWindowFocus: false`
   * per ADR-0006 §4: role / membership changes are a deliberate backend-403
   * canary, not a silent UI mutation. Selectors (`useNamespaceRole`,
   * `usePersonalNamespace`, `useAllUserNamespaces`) read this cache directly.
   */
  users: {
    me: () => ['users', 'me'] as const,
  },
  /** Single-namespace detail (members + metadata). */
  namespace: (handle: string) => ['namespace', handle] as const,
  namespaceMembers: (handle: string) => ['namespace-members', handle] as const,
  agentRuns: {
    /** Prefix matcher — `['agent-runs']` invalidates every list slice. */
    all: () => ['agent-runs'] as const,
    /** List slice — namespace + optional `runId`/`stepId` filters. */
    list: (
      handle: string | undefined,
      filters?: { runId?: string; stepId?: string },
    ) => ['agent-runs', handle ?? null, { ...filters }] as const,
    /** Keyset-paginated list (Monitoring → Agents) — distinct from `list`
     *  (the unbounded legacy read) since the two coexist. */
    page: (
      handle: string,
      filters: { status?: string; cardStatus?: string; processInstanceIds?: readonly string[] },
    ) => ['agent-runs', 'page', handle, { ...filters }] as const,
    /** Grouped AgentRunCardStatus counts backing the Agents tab's KPI
     *  cards — same filter shape as `page` minus `cardStatus` itself. */
    cardStatusCounts: (
      handle: string,
      filters: { status?: string; processInstanceIds?: readonly string[] },
    ) => ['agent-runs', 'card-status-counts', handle, { ...filters }] as const,
  },
  /** Single agent-run detail key (singular `agent-run`). */
  agentRun: (agentRunId: string) => ['agent-run', agentRunId] as const,
  monitoring: {
    /** Per-workspace dashboard summary. */
    summary: (handle: string) => ['monitoring', handle] as const,
  },
  /** Platform-wide model registry list (not workspace-scoped). */
  modelRegistry: {
    list: () => ['model-registry'] as const,
  },
  /** Workspace-wide audit trail (Monitoring → Users / Tasks tabs) —
   *  keyset-paginated, server-side filtered by action set + actor +
   *  date range. Each tab passes its own `actions` slice, so the two
   *  tabs' pages don't share a cache entry. */
  namespaceAuditEvents: (
    handle: string,
    filters: { actions: readonly string[]; actorId?: string; fromDate?: string; toDate?: string },
  ) => ['namespace-audit-events', handle, { ...filters }] as const,
} as const;
