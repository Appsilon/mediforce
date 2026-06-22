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
  readonly apiKey: () => string;
  readonly fetch?: typeof fetch;
}

// Getters so env reads happen at call time, not module-load time.
export function createHttpSelfFetchRunKicker(config: HttpSelfFetchRunKickerConfig): RunKicker {
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
        // fire-and-forget
      }
    },
  };
}
