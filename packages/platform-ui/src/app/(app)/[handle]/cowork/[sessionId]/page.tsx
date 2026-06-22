'use client';

import * as React from 'react';
import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { mediforce } from '@/lib/mediforce';
import { ChatCoworkView } from '@/components/cowork/chat-cowork-view';
import { VoiceCoworkView } from '@/components/cowork/voice-cowork-view';
import { useHandleFromPath } from '@/hooks/use-handle-from-path';
import { useProcessInstance } from '@/hooks/use-process-instances';
import { useCoworkSession } from '@/hooks/use-cowork';
import { routes } from '@/lib/routes';

export default function CoworkSessionPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const handle = useHandleFromPath();

  // Session metadata + polling (cadence is constant 5 s here — the chat
  // mutation's `isPending` lives inside ChatCoworkView, which owns the
  // turns query that flips to 1 s while a message is in-flight).
  const { session, loading } = useCoworkSession(sessionId, false);

  const { data: instance } = useProcessInstance(session?.processInstanceId ?? null);

  const definitionName = instance?.definitionName;
  const stepId = session?.stepId;
  const { data: stepDescription } = useQuery({
    queryKey: ['workflow-step-description', handle, definitionName, stepId],
    enabled: definitionName !== undefined && stepId !== undefined,
    queryFn: async () => {
      const { definition } = await mediforce.workflows.get({
        name: definitionName as string,
        namespace: handle,
      });
      const step = definition.steps.find((s) => s.id === stepId);
      return step?.description ?? null;
    },
  });

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
    return <div className="p-6 text-center text-sm text-muted-foreground">Session not found.</div>;
  }

  const runHref = instance ? routes.workflowRun(handle, instance.definitionName, instance.id) : null;

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

      {session.agent === 'voice-realtime' ? (
        <VoiceCoworkView
          session={session}
          instance={instance}
          handle={handle}
          stepDescription={stepDescription ?? undefined}
        />
      ) : (
        <ChatCoworkView
          session={session}
          instance={instance}
          handle={handle}
          stepDescription={stepDescription ?? undefined}
        />
      )}
    </div>
  );
}
