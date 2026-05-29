import type { HumanTaskStatus, InstanceStatus } from '@mediforce/platform-core';

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
    /** Runs scoped to a workspace handle, optionally narrowed by workflow + status. */
    byHandle: (
      handle: string,
      filters?: { workflow?: string; status?: InstanceStatus; limit?: number },
    ) => ['runs', handle, { ...filters }] as const,
    /** Workspace-scoped `id → definitionName` map. Lives under the `runs`
     *  prefix so mutation-driven invalidations refresh labels without per-site
     *  wiring; keyed by handle so two workspaces don't share a cache entry. */
    nameMap: (handle: string) => ['runs', 'name-map', handle] as const,
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

  /** Aggregate step-entry view for a process instance (processes.getSteps). */
  processSteps: (instanceId: string) => ['process-steps', instanceId] as const,

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
  agentRuns: {
    /** Prefix matcher — `['agent-runs']` invalidates every list slice. */
    all: () => ['agent-runs'] as const,
    /** List slice — namespace + optional `runId`/`stepId` filters. */
    list: (
      handle: string | undefined,
      filters?: { runId?: string; stepId?: string },
    ) => ['agent-runs', handle ?? null, { ...filters }] as const,
  },
  /** Single agent-run detail key (singular `agent-run`). */
  agentRun: (agentRunId: string) => ['agent-run', agentRunId] as const,
  monitoring: {
    /** Per-workspace dashboard summary. */
    summary: (handle: string) => ['monitoring', handle] as const,
  },
} as const;
