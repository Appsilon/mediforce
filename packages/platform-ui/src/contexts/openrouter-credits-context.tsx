'use client';

import { createContext, useContext, useState, useEffect, useCallback, useRef, type ReactNode } from 'react';
import { apiFetch } from '@/lib/api-fetch';
import type { OpenRouterCreditsResponse } from '@/app/api/system/openrouter-credits/route';

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
  const [state, setState] = useState<Omit<OpenRouterCreditsState, 'refresh'>>({
    available: false,
    remaining: 0,
    limit: 0,
    usage: 0,
    isLoading: true,
  });
  const cancelledRef = useRef(false);

  const fetchCredits = useCallback(async () => {
    try {
      const res = await apiFetch('/api/system/openrouter-credits');
      if (!res.ok || cancelledRef.current) return;
      const data = await res.json() as OpenRouterCreditsResponse;
      if (cancelledRef.current) return;
      setState({
        available: data.available,
        remaining: data.remaining,
        limit: data.limit,
        usage: data.usage,
        isLoading: false,
        error: data.error,
      });
    } catch {
      if (!cancelledRef.current) {
        setState((prev) => ({ ...prev, isLoading: false, error: 'Failed to fetch credits' }));
      }
    }
  }, []);

  useEffect(() => {
    cancelledRef.current = false;
    fetchCredits();
    const interval = setInterval(fetchCredits, REFRESH_INTERVAL_MS);
    return () => { cancelledRef.current = true; clearInterval(interval); };
  }, [fetchCredits]);

  return (
    <OpenRouterCreditsContext.Provider value={{ ...state, refresh: fetchCredits }}>
      {children}
    </OpenRouterCreditsContext.Provider>
  );
}

export function useOpenRouterCredits(): OpenRouterCreditsState {
  return useContext(OpenRouterCreditsContext);
}
