'use client';

import * as React from 'react';
import { useParams } from 'next/navigation';
import { doc, onSnapshot, collection, query, where, getDocs } from 'firebase/firestore';
import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import type { CoworkSession, ProcessInstance, WorkflowDefinition } from '@mediforce/platform-core';
import { db } from '@/lib/firebase';
import { ConversationView } from '@/components/cowork/conversation-view';
import { useHandleFromPath } from '@/hooks/use-handle-from-path';
import { useProcessInstance } from '@/hooks/use-process-instances';
import { routes } from '@/lib/routes';

export default function CoworkSessionPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const handle = useHandleFromPath();
  const [session, setSession] = React.useState<CoworkSession | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [stepDescription, setStepDescription] = React.useState<string | undefined>(undefined);

  // Load session via real-time listener
  React.useEffect(() => {
    if (!sessionId) return;
    const unsub = onSnapshot(doc(db, 'coworkSessions', sessionId), (snap) => {
      if (snap.exists()) {
        setSession({ id: snap.id, ...snap.data() } as CoworkSession);
      } else {
        setSession(null);
      }
      setLoading(false);
    });
    return unsub;
  }, [sessionId]);

  // Load process instance
  const { data: instance } = useProcessInstance(session?.processInstanceId ?? null);

  // Load step description from workflow definition
  React.useEffect(() => {
    if (!instance || !session) return;

    async function loadStepDescription() {
      const colRef = collection(db, 'workflowDefinitions');
      const q = query(
        colRef,
        where('name', '==', instance!.definitionName),
      );
      const snap = await getDocs(q);
      if (snap.empty) return;

      const def = snap.docs[0].data() as WorkflowDefinition;
      const step = def.steps?.find((s) => s.id === session!.stepId);
      if (step?.description) {
        setStepDescription(step.description);
      }
    }

    loadStepDescription();
  }, [instance?.definitionName, session?.stepId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) {
    return (
      <div className="p-6 space-y-4">
        <div className="h-4 w-20 rounded bg-muted animate-pulse" />
        <div className="h-8 w-2/3 rounded bg-muted animate-pulse" />
        <div className="h-[60vh] rounded bg-muted animate-pulse" />
      </div>
    );
  }

  if (!session) {
    return (
      <div className="p-6 text-center text-sm text-muted-foreground">
        Session not found.
      </div>
    );
  }

  const runHref = instance
    ? routes.workflowRun(handle, instance.definitionName, instance.id)
    : null;

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center gap-4">
        <Link
          href={runHref ?? `/${handle}`}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to run
        </Link>
        <div className="flex-1">
          <h1 className="text-xl font-headline font-semibold">
            {instance
              ? instance.definitionName.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
              : 'Co-work Session'}
          </h1>
          <p className="text-xs text-muted-foreground">
            Step: {session.stepId} &middot; Instance: {session.processInstanceId.slice(0, 8)}...
          </p>
        </div>
      </div>

      <ConversationView
        session={session}
        instance={instance}
        handle={handle}
        stepDescription={stepDescription}
      />
    </div>
  );
}
