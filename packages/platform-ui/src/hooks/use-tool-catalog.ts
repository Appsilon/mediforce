'use client';

import { useQuery } from '@tanstack/react-query';
import type { ToolCatalogEntry } from '@mediforce/platform-core';
import { mediforce } from '@/lib/mediforce';
import { queryKeys } from '@/lib/query-keys';
import { stopRetryOn4xx } from '@/lib/retry';
import { NICE_LIVE_INTERVAL_MS } from '@/lib/polling-cadence';

/** The workspace's MCP Tool Catalog. An unresolved namespace fetches nothing
 *  and reads as empty; so does a failed read, because callers use the catalog
 *  to *add* warnings, never to gate anything. */
export function useToolCatalogEntries(namespace: string | undefined): ToolCatalogEntry[] {
  const query = useQuery({
    queryKey: queryKeys.toolCatalog(namespace ?? ''),
    queryFn: async () => (await mediforce.toolCatalog.list({ namespace: namespace ?? '' })).entries,
    enabled: namespace !== undefined && namespace !== '',
    staleTime: NICE_LIVE_INTERVAL_MS,
    retry: stopRetryOn4xx,
  });
  return query.data ?? [];
}
