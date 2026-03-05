'use client';

import { useState, useEffect, useCallback } from 'react';
import { collection, query, where, onSnapshot } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { ProcessConfig } from '@mediforce/platform-core';

export function useProcessConfigs(processName: string) {
  const [configs, setConfigs] = useState<ProcessConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!processName) {
      setLoading(false);
      return;
    }

    const q = query(
      collection(db, 'processConfigs'),
      where('processName', '==', processName),
    );

    const unsub = onSnapshot(
      q,
      (snapshot) => {
        const results: ProcessConfig[] = [];
        snapshot.forEach((doc) => {
          results.push(doc.data() as ProcessConfig);
        });
        setConfigs(results);
        setLoading(false);
        setError(null);
      },
      (err) => {
        setError(err.message);
        setLoading(false);
      },
    );

    return unsub;
  }, [processName]);

  const refetch = useCallback(() => {
    // With onSnapshot, data is live -- refetch is a no-op
  }, []);

  return { configs, loading, error, refetch };
}
