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
 * (`'task'`, `'run'`) so list-prefix invalidation of `['tasks']` / `['runs']`
 * does not clobber the detail cache. Detail and list are different surfaces.
 *
 * Currently covers tasks, runs / processes / audit, cowork, users (`me`),
 * namespace (detail). Future work extends with `workflows`, `agent-runs`,
 * `monitoring`.
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
    /** Prefix matcher — `['runs']` invalidates every list slice. */
    all: () => ['runs'] as const,
    /** Runs scoped to a workspace handle, optionally narrowed by workflow + status. */
    byHandle: (
      handle: string,
      filters?: { workflow?: string; status?: InstanceStatus; limit?: number },
    ) => ['runs', handle, { ...filters }] as const,
  },
  run: (runId: string) => ['run', runId] as const,

  /** Audit-trail key, scoped per run. List domain so consumers can tag-prefix
   *  invalidate `['audit']` across every detail page if needed. */
  audit: (runId: string) => ['audit', runId] as const,

  cowork: {
    /** Session metadata key (status, artifact, model, voice config). */
    session: (sessionId: string) => ['cowork', sessionId] as const,
    /** Conversation turns key — separate cache surface from session
     * metadata so chat-mutation optimistic prepends operate on a focused
     * scope without invalidating session metadata. */
    turns: (sessionId: string) => ['cowork', sessionId, 'turns'] as const,
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
} as const;
