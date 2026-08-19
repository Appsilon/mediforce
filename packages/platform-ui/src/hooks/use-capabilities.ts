'use client';

import { useQuery } from '@tanstack/react-query';
import { mediforce } from '@/lib/mediforce';
import { queryKeys } from '@/lib/query-keys';
import { stopRetryOn4xx } from '@/lib/retry';
import { NICE_LIVE_INTERVAL_MS } from '@/lib/polling-cadence';
import type { CapabilityStatus } from '@mediforce/platform-api/contract';

type Capabilities = Record<string, CapabilityStatus>;

/**
 * Reference data that moves only on redeploy or an admin wiring up email, hence
 * NICE LIVE.
 *
 * `null` means "not known yet" — loading or failed. Callers treat unknown as
 * available: greying out every block over one failed request is the worse
 * failure.
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
