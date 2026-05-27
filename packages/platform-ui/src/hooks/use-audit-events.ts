'use client';

import type { AuditEvent } from '@mediforce/platform-core';
import { mediforce } from '@/lib/mediforce';
import { useRetro } from './use-swr-mediforce';

type AuditEventWithId = AuditEvent & { id: string };

/**
 * Polls audit events for a single run via `mediforce.processes.listAuditEvents`.
 * 5s tier per PLAN-0001 §3 — audit events are retro / append-only.
 */
export function useAuditEvents(processInstanceId: string | null) {
  const key = processInstanceId === null
    ? null
    : (['audit-events', processInstanceId] as const);

  const { data, isLoading, error } = useRetro(
    key,
    async ([, instanceId]) => {
      const result = await mediforce.processes.listAuditEvents({ instanceId });
      return result.events as AuditEventWithId[];
    },
  );

  const sorted = data === undefined
    ? []
    : [...data].sort((a, b) => a.timestamp.localeCompare(b.timestamp));

  return {
    data: sorted,
    loading: isLoading,
    error: error ?? null,
  };
}
