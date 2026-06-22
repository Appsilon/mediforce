'use client';

import { useState, useEffect } from 'react';
import { apiFetch } from '@/lib/api-fetch';

interface RankingsAge {
  daysSinceUpdate: number | null;
  rankingsUpdatedAt: string | null;
  loading: boolean;
}

export function useRankingsAge(): RankingsAge {
  const [state, setState] = useState<RankingsAge>({
    daysSinceUpdate: null,
    rankingsUpdatedAt: null,
    loading: true,
  });

  useEffect(() => {
    apiFetch('/api/model-registry/meta')
      .then((res) => res.json())
      .then((data: { meta: { rankingsUpdatedAt: string | null } }) => {
        const updatedAt = data.meta.rankingsUpdatedAt;
        const daysSince = updatedAt ? Math.floor((Date.now() - new Date(updatedAt).getTime()) / 86_400_000) : null;
        setState({
          daysSinceUpdate: daysSince,
          rankingsUpdatedAt: updatedAt,
          loading: false,
        });
      })
      .catch(() => setState((prev) => ({ ...prev, loading: false })));
  }, []);

  return state;
}
