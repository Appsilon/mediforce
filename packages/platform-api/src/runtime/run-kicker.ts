/**
 * Notify the runtime that an instance has been advanced and needs the
 * auto-runner to execute its current step.
 *
 * Fire-and-forget — `kick` resolves when the kick is dispatched, not when the
 * resulting run completes. Idempotent: if the runtime is already executing
 * this instance the kick is a no-op at the transport layer.
 *
 * Handlers reach this via `scope.system.runKicker.kick(instanceId)`. The
 * abstraction lets `WorkflowEngine` stay a pure state machine and lets a
 * future durable executor (queue, cron worker) swap one impl without
 * touching handlers — see ADR-0005 §7 / headless-migration Phase 3.
 */
export interface RunKicker {
  kick(instanceId: string, opts?: { readonly triggeredBy?: string }): Promise<void>;
}

export interface KickRecord {
  readonly instanceId: string;
  readonly triggeredBy: string | undefined;
}

export interface NoopRunKicker extends RunKicker {
  readonly kicks: ReadonlyArray<KickRecord>;
}

/**
 * Test impl. Records every call on `kicks`; tests assert the array contents
 * to verify the handler kicked with the right id.
 */
export function noopRunKicker(): NoopRunKicker {
  const kicks: KickRecord[] = [];
  return {
    get kicks() {
      return kicks;
    },
    async kick(instanceId, opts) {
      kicks.push({ instanceId, triggeredBy: opts?.triggeredBy });
    },
  };
}

export interface HttpSelfFetchRunKickerConfig {
  readonly baseUrl: () => string;
  readonly apiKey: () => string;
  readonly fetch?: typeof fetch;
}

/**
 * Production impl: self-fetches `POST /api/processes/:id/run` with the
 * platform API key. Encapsulates exactly today's pattern — `getAppBaseUrl()`
 * + `fetch(...)` + `X-Api-Key` header + `.catch(() => {})`. Errors are
 * intentionally swallowed: the kick is fire-and-forget; downstream auto-
 * runner failures show up in the run's own audit trail, not here.
 *
 * The `baseUrl` / `apiKey` getters are functions, not strings, so callers
 * can plug `getAppBaseUrl` (which reads env at call time and is overridable
 * by tests) without baking a startup-time URL into a module singleton.
 */
export function createHttpSelfFetchRunKicker(
  config: HttpSelfFetchRunKickerConfig,
): RunKicker {
  const fetchImpl = config.fetch ?? globalThis.fetch;
  return {
    async kick(instanceId, opts) {
      const url = `${config.baseUrl()}/api/processes/${encodeURIComponent(instanceId)}/run`;
      try {
        await fetchImpl(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Api-Key': config.apiKey(),
          },
          body: JSON.stringify({ triggeredBy: opts?.triggeredBy ?? 'api-user' }),
        });
      } catch {
        // fire-and-forget — see header comment.
      }
    },
  };
}
