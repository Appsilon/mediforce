'use client';

import * as React from 'react';
import { mediforce } from '@/lib/mediforce';
import { useAuth } from '@/contexts/auth-context';

interface WorkflowSecretKeysContextValue {
  getKeys: (workflowName: string) => string[] | undefined;
  namespaceKeys: string[];
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
  const [nsKeys, setNsKeys] = React.useState<string[]>([]);
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

    Promise.all([
      mediforce.secrets.workflowKeysBatch({ namespace: handle, workflows: workflowNames }),
      mediforce.secrets.list({ namespace: handle }),
    ])
      .then(([workflowResult, namespaceResult]) => {
        if (cancelled) return;
        const map = new Map<string, string[]>();
        for (const [name, keys] of Object.entries(workflowResult.keysByWorkflow)) {
          map.set(name, keys);
        }
        setSecretsByWorkflow(map);
        setNsKeys(namespaceResult.keys);
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        console.warn('[WorkflowSecretKeys] Failed to fetch secret keys:', err);
        setSecretsByWorkflow(new Map());
        setNsKeys([]);
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
    () => ({ getKeys, namespaceKeys: nsKeys, loading }),
    [getKeys, nsKeys, loading],
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
