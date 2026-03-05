'use client';

import { useMemo } from 'react';
import { where } from 'firebase/firestore';
import type { AuditEvent } from '@mediforce/platform-core';
import { useCollection } from './use-collection';

type AuditEventWithId = AuditEvent & { id: string };

export function useAuditEvents(processInstanceId: string | null) {
  // NOTE: orderBy('timestamp') is intentionally omitted — combining where() on one field
  // with orderBy() on another requires a composite Firestore index. Sort client-side instead.
  const constraints = useMemo(
    () =>
      processInstanceId
        ? [where('processInstanceId', '==', processInstanceId)]
        : [],
    [processInstanceId],
  );
  const result = useCollection<AuditEventWithId>('auditEvents', processInstanceId ? constraints : []);
  return {
    ...result,
    data: [...result.data].sort((a, b) => a.timestamp.localeCompare(b.timestamp)),
  };
}
