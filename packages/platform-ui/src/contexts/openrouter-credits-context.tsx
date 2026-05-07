'use client';

import { createContext, useContext, useState, useEffect, useCallback, useMemo, useRef, type ReactNode } from 'react';
import { useHandleFromPath } from '@/hooks/use-handle-from-path';
import { apiFetch } from '@/lib/api-fetch';
import type { OpenRouterCreditsOutput } from '@mediforce/platform-api/contract';

export interface OpenRouterCreditsState {
  available: boolean;
  remaining: number;
  limit: number;
  usage: number;
  isLoading: boolean;
  error?: string;
  refresh: () => void;
}

const REFRESH_INTERVAL_MS = 120_000;

const OpenRouterCreditsContext = createContext<OpenRouterCreditsState>({
  available: false,
  remaining: 0,
  limit: 0,
  usage: 0,
  isLoading: true,
  refresh: () => {},
});

export function OpenRouterCreditsProvider({ children }: { children: ReactNode }) {
  const handle = useHandleFromPath();
  const [available, setAvailable] = useState(false);
  const [remaining, setRemaining] = useState(0);
  const [limit, setLimit] = useState(0);
  const [usage, setUsage] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | undefined>();
  const [activated, setActivated] = useState(false);
  const cancelledRef = useRef(false);

  const fetchCredits = useCallback(async () => {
    if (!handle) return;
    try {
      const res = await apiFetch(`/api/system/openrouter-credits?namespace=${encodeURIComponent(handle)}`);
      if (!res.ok || cancelledRef.current) return;
      const data = await res.json() as OpenRouterCreditsOutput;
      if (cancelledRef.current) return;
      setAvailable(data.available);
      setRemaining(data.remaining);
      setLimit(data.limit);
      setUsage(data.usage);
      setIsLoading(false);
      setError(data.error);
    } catch {
      if (!cancelledRef.current) {
        setIsLoading(false);
        setError('Failed to fetch credits');
      }
    }
  }, [handle]);

  useEffect(() => {
    if (!activated || !handle) return;
    cancelledRef.current = false;
    fetchCredits();
    const interval = setInterval(fetchCredits, REFRESH_INTERVAL_MS);
    return () => { cancelledRef.current = true; clearInterval(interval); };
  }, [activated, handle, fetchCredits]);

  const activate = useCallback(() => setActivated(true), []);

  const value = useMemo<OpenRouterCreditsState>(() => ({
    available,
    remaining,
    limit,
    usage,
    isLoading,
    error,
    refresh: fetchCredits,
  }), [available, remaining, limit, usage, isLoading, error, fetchCredits]);

  return (
    <ActivateContext.Provider value={activate}>
      <OpenRouterCreditsContext.Provider value={value}>
        {children}
      </OpenRouterCreditsContext.Provider>
    </ActivateContext.Provider>
  );
}

const ActivateContext = createContext<() => void>(() => {});

export function useOpenRouterCredits(): OpenRouterCreditsState {
  const activate = useContext(ActivateContext);
  useEffect(() => { activate(); }, [activate]);
  return useContext(OpenRouterCreditsContext);
}
