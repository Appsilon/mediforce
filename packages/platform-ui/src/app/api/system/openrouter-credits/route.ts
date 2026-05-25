import { createRouteAdapter } from '@/lib/route-adapter';
import { getOpenRouterCredits } from '@mediforce/platform-api/handlers';
import {
  OpenRouterCreditsInputSchema,
  type OpenRouterCreditsInput,
} from '@mediforce/platform-api/contract';

/**
 * GET /api/system/openrouter-credits?namespace=…
 *
 * Reads the workspace's OPENROUTER_API_KEY via the scoped wrapper and
 * proxies to openrouter.ai. All failure modes (no key, upstream error,
 * unexpected shape) degrade to `{available: false, error}` without
 * throwing — the UI panel renders a single fallback.
 */
export const GET = createRouteAdapter<
  typeof OpenRouterCreditsInputSchema,
  OpenRouterCreditsInput
>(
  OpenRouterCreditsInputSchema,
  (req) => ({ namespace: req.nextUrl.searchParams.get('namespace') ?? undefined }),
  getOpenRouterCredits,
);
