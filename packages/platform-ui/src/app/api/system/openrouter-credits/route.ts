import { createRouteAdapter } from '@/lib/route-adapter';
import { getOpenRouterCredits } from '@mediforce/platform-api/handlers';
import { OpenRouterCreditsInputSchema, type OpenRouterCreditsInput } from '@mediforce/platform-api/contract';

// Why: Next-specific 60s revalidate on the upstream openrouter.ai fetch.
// Lives at the route layer so the handler stays framework-free.
const cachedFetch: typeof globalThis.fetch = (input, init) =>
  globalThis.fetch(input, { ...init, next: { revalidate: 60 } });

export const GET = createRouteAdapter<typeof OpenRouterCreditsInputSchema, OpenRouterCreditsInput>(
  OpenRouterCreditsInputSchema,
  (req) => ({ namespace: req.nextUrl.searchParams.get('namespace') ?? undefined }),
  (input, scope) => getOpenRouterCredits(input, scope, { fetch: cachedFetch }),
);
