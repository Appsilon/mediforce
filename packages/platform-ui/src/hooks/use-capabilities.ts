'use client';

import { useState, useEffect } from 'react';
import { apiFetch } from '@/lib/api-fetch';
import type { CapabilityStatus } from '@mediforce/platform-api/contract';

type Capabilities = Record<string, CapabilityStatus>;

/**
 * What this instance can actually run, for gating pre-made blocks.
 *
 * An unreachable endpoint reads as "unknown", and callers treat unknown as
 * available — a picker that hides every block because one fetch failed is
 * worse than one that offers a block the run later reports on.
 */
export function useCapabilities() {
  const [capabilities, setCapabilities] = useState<Capabilities | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function fetchCapabilities() {
      try {
        const res = await apiFetch('/api/capabilities');
        if (!res.ok) throw new Error(`Failed to fetch capabilities: ${res.status}`);
        const data = await res.json() as { capabilities?: Capabilities };
        if (!cancelled) setCapabilities(data.capabilities ?? {});
      } catch {
        if (!cancelled) setCapabilities(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchCapabilities();
    return () => { cancelled = true; };
  }, []);

  return { capabilities, loading };
}
