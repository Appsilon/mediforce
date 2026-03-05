'use client';

import { useState, useEffect } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '@/lib/firebase';

interface StepConfigData {
  stepId: string;
  executorType?: string;
  autonomyLevel?: string;
  [key: string]: unknown;
}

interface ProcessConfigData {
  processName: string;
  configName: string;
  configVersion: string;
  stepConfigs: StepConfigData[];
  [key: string]: unknown;
}

/**
 * Load a ProcessConfig document from Firestore by 3-part key: processName, configName, configVersion.
 * Document IDs use the composite key pattern: `{processName}:{configName}:{configVersion}`.
 */
export function useProcessConfig(
  processName: string | null,
  configName: string | null,
  configVersion: string | null,
) {
  const [data, setData] = useState<ProcessConfigData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!processName || !configName || !configVersion) {
      setLoading(false);
      return;
    }

    const compositeKey = `${processName}:${configName}:${configVersion}`;
    const docRef = doc(db, 'processConfigs', compositeKey);

    const unsub = onSnapshot(docRef, (snap) => {
      if (snap.exists()) {
        setData({ id: snap.id, ...snap.data() } as unknown as ProcessConfigData);
      } else {
        setData(null);
      }
      setLoading(false);
    });

    return unsub;
  }, [processName, configName, configVersion]);

  return { data, loading };
}
