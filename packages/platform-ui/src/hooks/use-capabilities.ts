'use client';

import { useQuery } from '@tanstack/react-query';
import { mediforce } from '@/lib/mediforce';
import { queryKeys } from '@/lib/query-keys';
import { stopRetryOn4xx } from '@/lib/retry';
import { NICE_LIVE_INTERVAL_MS } from '@/lib/polling-cadence';
import type { CapabilityStatus } from '@mediforce/platform-api/contract';

type Capabilities = Record<string, CapabilityStatus>;

/**
 * What this deployment can actually run, for gating pre-made blocks.
 *
 * Deployment-wide reference data that only moves when someone redeploys or an
 * admin wires up email, so NICE LIVE (30 s) is generous.
 *
 * Returns `null` until the answer is known — while loading and if the request
 * fails. Callers treat unknown as available, because a picker that greys out
 * every block over one failed request is a worse failure than one that offers a
 * block the run later reports on.
 */
export function useCapabilities(): { capabilities: Capabilities | null; loading: boolean } {
  const query = useQuery({
    queryKey: queryKeys.capabilities(),
    queryFn: async () => (await mediforce.capabilities.get()).capabilities,
    staleTime: NICE_LIVE_INTERVAL_MS,
    retry: stopRetryOn4xx,
  });

  return { capabilities: query.data ?? null, loading: query.isPending };
}
