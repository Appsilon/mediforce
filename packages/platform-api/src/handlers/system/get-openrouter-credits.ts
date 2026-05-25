import type { CallerScope } from '../../repositories/index.js';
import type {
  OpenRouterCreditsInput,
  OpenRouterCreditsOutput,
} from '../../contract/system.js';

const EMPTY: OpenRouterCreditsOutput = {
  available: false,
  limit: 0,
  usage: 0,
  remaining: 0,
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
  let apiKey: string | undefined;
  try {
    const secrets = await scope.workspaceSecrets.getSecrets(input.namespace);
    apiKey = secrets['OPENROUTER_API_KEY'];
  } catch (err) {
    return { ...EMPTY, error: err instanceof Error ? err.message : 'Failed to read workspace secrets' };
  }

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
    return {
      available: true,
      limit: data.limit ?? 0,
      usage: data.usage ?? 0,
      remaining: data.limit_remaining,
    };
  } catch (err) {
    return { ...EMPTY, error: err instanceof Error ? err.message : 'Unknown error' };
  }
}
