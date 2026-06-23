// Fire-and-forget; idempotent at transport layer.
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
  /** Optional override of the host used for the loopback self-fetch.
   *  Set this on deployment topologies where the running process can't
   *  reach its own `baseUrl` from the inside — notably Kubernetes pods
   *  with an external ALB (the pod has no route back through the ALB to
   *  itself). Point it at the cluster-internal Service URL
   *  (e.g. `http://mediforce-ui:3000`).
   *
   *  When unset, returns undefined, returns an empty string, or returns
   *  a malformed URL, the kicker falls back to `baseUrl()` — identical
   *  to the prior behaviour, so VM / docker-compose / Vercel deployments
   *  that don't set this need no other changes. */
  readonly internalUrl?: () => string | undefined;
  readonly apiKey: () => string;
  readonly fetch?: typeof fetch;
}

/** Resolves which host the kicker self-fetches against — the in-cluster
 *  override when valid, falling back to `baseUrl()` for all the empty /
 *  malformed / not-supplied cases. URL parsing is done with `new URL`,
 *  so anything that doesn't parse safely falls through. */
function resolveHost(config: HttpSelfFetchRunKickerConfig): string {
  const raw = config.internalUrl?.();
  if (raw) {
    try {
      return new URL(raw).origin;
    } catch {
      // operator typo / docker-compose `${VAR:-}` empty-string variant —
      // fall through to baseUrl rather than crashing the kicker
    }
  }
  return config.baseUrl();
}

// Getters so env reads happen at call time, not module-load time.
export function createHttpSelfFetchRunKicker(
  config: HttpSelfFetchRunKickerConfig,
): RunKicker {
  const fetchImpl = config.fetch ?? globalThis.fetch;
  return {
    async kick(instanceId, opts) {
      const url = `${resolveHost(config)}/api/processes/${encodeURIComponent(instanceId)}/run`;
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
        // fire-and-forget
      }
    },
  };
}
