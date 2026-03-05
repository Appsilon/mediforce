'use client';

import type { AgentRun } from '@mediforce/platform-core';
import { useMemo } from 'react';

interface StatCardsProps {
  runs: AgentRun[];
  loading: boolean;
}

interface StatCard {
  label: string;
  value: number;
  borderColor: string;
}

function SkeletonCard() {
  return (
    <div className="rounded-lg border bg-card p-4 border-l-4 border-l-muted">
      <div className="h-3 w-20 rounded bg-muted animate-pulse mb-2" />
      <div className="h-7 w-12 rounded bg-muted animate-pulse" />
    </div>
  );
}

export function StatCards({ runs, loading }: StatCardsProps) {
  const stats = useMemo<StatCard[]>(() => {
    const total = runs.length;
    const errors = runs.filter((r) => r.status === 'error').length;
    const lowConfidence = runs.filter((r) => r.status === 'low_confidence').length;
    const escalated = runs.filter((r) => r.status === 'escalated').length;

    return [
      { label: 'Total Runs', value: total, borderColor: 'border-l-blue-500' },
      { label: 'Errors', value: errors, borderColor: 'border-l-red-500' },
      { label: 'Low Confidence', value: lowConfidence, borderColor: 'border-l-amber-500' },
      { label: 'Escalated', value: escalated, borderColor: 'border-l-orange-500' },
    ];
  }, [runs]);

  if (loading) {
    return (
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <SkeletonCard key={i} />
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
      {stats.map((stat) => (
        <div
          key={stat.label}
          className={`rounded-lg border bg-card p-4 border-l-4 ${stat.borderColor}`}
        >
          <p className="text-xs text-muted-foreground">{stat.label}</p>
          <p className="text-2xl font-semibold mt-1">{stat.value}</p>
        </div>
      ))}
    </div>
  );
}
