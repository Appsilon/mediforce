'use client';

import * as React from 'react';
import { getWorkflowSecretKeysBatch } from '@/app/actions/workflow-secrets';
import { useAuth } from '@/contexts/auth-context';

interface WorkflowSecretKeysContextValue {
  getKeys: (workflowName: string) => string[] | undefined;
  loading: boolean;
}

const WorkflowSecretKeysContext = React.createContext<WorkflowSecretKeysContextValue | null>(null);

export function WorkflowSecretKeysProvider({
  handle,
  workflowNames,
  children,
}: {
  handle: string;
  workflowNames: string[];
  children: React.ReactNode;
}) {
  const { firebaseUser } = useAuth();
  const [secretsByWorkflow, setSecretsByWorkflow] = React.useState<Map<string, string[]>>(new Map());
  const [loading, setLoading] = React.useState(true);

  const uid = firebaseUser?.uid;
  const namesKey = React.useMemo(() => [...workflowNames].sort().join(','), [workflowNames]);

  React.useEffect(() => {
    if (!handle || !uid || workflowNames.length === 0) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);

    getWorkflowSecretKeysBatch(handle, workflowNames, uid)
      .then((result) => {
        if (cancelled) return;
        const map = new Map<string, string[]>();
        for (const [name, keys] of Object.entries(result)) {
          map.set(name, keys);
        }
        setSecretsByWorkflow(map);
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        console.warn('[WorkflowSecretKeys] Failed to fetch secret keys:', err);
        setSecretsByWorkflow(new Map());
        setLoading(false);
      });

    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handle, uid, namesKey]);

  const getKeys = React.useCallback(
    (workflowName: string) => secretsByWorkflow.get(workflowName),
    [secretsByWorkflow],
  );

  const value = React.useMemo(
    () => ({ getKeys, loading }),
    [getKeys, loading],
  );

  return (
    <WorkflowSecretKeysContext.Provider value={value}>
      {children}
    </WorkflowSecretKeysContext.Provider>
  );
}

export function useWorkflowSecretKeysContext(): WorkflowSecretKeysContextValue | null {
  return React.useContext(WorkflowSecretKeysContext);
}
