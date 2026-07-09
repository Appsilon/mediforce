import type { CallerScope } from '../../repositories/index';
import type {
  OpenRouterCreditsInput,
  OpenRouterCreditsOutput,
} from '../../contract/system';

const EMPTY: OpenRouterCreditsOutput = {
  available: false,
  limit: 0,
  usage: 0,
  remaining: 0,
  effectiveRemaining: 0,
};

export interface GetOpenRouterCreditsOptions {
  /** Override for tests / loopback. Defaults to `globalThis.fetch`. */
  readonly fetch?: typeof globalThis.fetch;
}

/**
 * Fetch the workspace's OpenRouter credit balance. Reads the workspace's
 * `OPENROUTER_API_KEY` via the scoped wrapper (soft-fails to empty for
 * non-members — same shape as "not configured", per the wrapper contract),
 * then calls openrouter.ai. All upstream failure modes degrade to a
 * non-throwing response with `available: false` + an error string, so the UI
 * panel can render a single fallback regardless of the cause.
 */
export async function getOpenRouterCredits(
  input: OpenRouterCreditsInput,
  scope: CallerScope,
  options: GetOpenRouterCreditsOptions = {},
): Promise<OpenRouterCreditsOutput> {
  const secrets = await scope.workspaceSecrets.getSecrets(input.namespace);
  const apiKey = secrets['OPENROUTER_API_KEY'];

  if (apiKey === undefined || apiKey === '') {
    return { ...EMPTY, error: 'OPENROUTER_API_KEY not configured in workspace secrets' };
  }

  return fetchCredits(apiKey, options.fetch ?? globalThis.fetch);
}

async function fetchCredits(
  apiKey: string,
  fetchImpl: typeof globalThis.fetch,
): Promise<OpenRouterCreditsOutput> {
  try {
    const res = await fetchImpl('https://openrouter.ai/api/v1/auth/key', {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!res.ok) {
      return { ...EMPTY, error: `OpenRouter returned ${res.status}` };
    }
    const body = (await res.json()) as {
      data?: { limit?: number; usage?: number; limit_remaining?: number };
    };
    const data = body?.data;
    if (!data || typeof data.limit_remaining !== 'number') {
      return { ...EMPTY, error: 'Unexpected response shape from OpenRouter' };
    }
    const remaining = data.limit_remaining;
    const accountRemaining = await fetchAccountRemaining(apiKey, fetchImpl);
    const effectiveRemaining =
      accountRemaining === undefined ? remaining : Math.min(remaining, accountRemaining);
    return {
      available: true,
      limit: data.limit ?? 0,
      usage: data.usage ?? 0,
      remaining,
      accountRemaining,
      effectiveRemaining,
    };
  } catch (err) {
    return { ...EMPTY, error: err instanceof Error ? err.message : 'Unknown error' };
  }
}

/**
 * Account prepaid credit remaining from `GET /credits`. This is the balance the
 * runtime actually charges against, separate from the per-key cap. Returns
 * `undefined` on any failure so the caller degrades to key-level numbers
 * instead of dropping the whole response.
 */
async function fetchAccountRemaining(
  apiKey: string,
  fetchImpl: typeof globalThis.fetch,
): Promise<number | undefined> {
  try {
    const res = await fetchImpl('https://openrouter.ai/api/v1/credits', {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!res.ok) {
      return undefined;
    }
    const body = (await res.json()) as {
      data?: { total_credits?: number; total_usage?: number };
    };
    const data = body?.data;
    if (
      !data ||
      typeof data.total_credits !== 'number' ||
      typeof data.total_usage !== 'number'
    ) {
      return undefined;
    }
    return data.total_credits - data.total_usage;
  } catch {
    return undefined;
  }
}
