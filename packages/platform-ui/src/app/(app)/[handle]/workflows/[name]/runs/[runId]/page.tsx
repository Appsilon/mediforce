'use client';

import { useParams } from 'next/navigation';
import { useMemo } from 'react';
import type { StepExecution, AuditEvent, WorkflowStep } from '@mediforce/platform-core';
import { useProcessInstance, useSubcollection } from '@/hooks/use-process-instances';
import { useAuditEvents } from '@/hooks/use-audit-events';
import { useWorkflowDefinitions } from '@/hooks/use-workflow-definitions';
import { resolveDefinitionSteps } from '@/lib/resolve-definition-steps';
import { ProcessDetail } from '@/components/processes/process-detail';

type AuditEventWithId = AuditEvent & { id: string };
type StepExecutionWithId = StepExecution;

export default function RunDetailPage() {
  const { name, runId, handle } = useParams<{ name: string; runId: string; handle: string }>();

  const decodedName = name ? decodeURIComponent(name) : '';

  const { data: instance, loading: instanceLoading } = useProcessInstance(runId ?? null);
  const { data: stepExecutions } = useSubcollection<StepExecutionWithId>(
    runId ? `processInstances/${runId}` : '',
    'stepExecutions',
  );
  const { data: agentEvents } = useSubcollection<{ id: string; stepId: string; type: string; payload: unknown; sequence: number }>(
    runId ? `processInstances/${runId}` : '',
    'agentEvents',
  );
  const { data: auditEvents, loading: auditLoading, error: auditError } = useAuditEvents(runId ?? null);

  // Load workflow definitions to get steps for the StepStatusPanel
  const { definitions: workflowVersions } = useWorkflowDefinitions(decodedName);

  const definitionSteps = useMemo(
    () => resolveDefinitionSteps(instance, workflowVersions),
    [instance, workflowVersions],
  );

  // Build step config map from WorkflowStep definitions embedded in WorkflowDefinition.
  const stepConfigMap = useMemo(() => {
    if (definitionSteps.length > 0) {
      const entries = definitionSteps
        .map((s) => {
          const ws = s as unknown as WorkflowStep;
          if (!ws.executor) return null;
          return [
            ws.id,
            {
              executorType: ws.executor,
              autonomyLevel: ws.autonomyLevel,
              plugin: ws.plugin,
              model: ws.agent?.model,
              confidenceThreshold: ws.agent?.confidenceThreshold,
              fallbackBehavior: ws.agent?.fallbackBehavior,
              timeoutMinutes: ws.agent?.timeoutMinutes ?? (ws.agent?.timeoutMs !== undefined ? ws.agent.timeoutMs / 60000 : undefined),
              reviewerType: ws.review?.type,
              agentConfig: ws.agent,
            },
          ] as const;
        })
        .filter((e): e is NonNullable<typeof e> => e !== null);
      if (entries.length > 0) return new Map(entries);
    }

    return undefined;
  }, [definitionSteps]);


  if (instanceLoading) {
    return (
      <div className="p-6 space-y-4">
        <div className="h-4 w-20 rounded bg-muted animate-pulse" />
        <div className="h-8 w-1/2 rounded bg-muted animate-pulse" />
        <div className="h-48 rounded bg-muted animate-pulse" />
      </div>
    );
  }

  if (!instance) {
    return (
      <div className="p-6 text-center text-sm text-muted-foreground">
        Run not found.
      </div>
    );
  }

  return (
    <ProcessDetail
      instance={instance}
      stepExecutions={stepExecutions}
      auditEvents={auditEvents as AuditEventWithId[]}
      auditEventsLoading={auditLoading}
      auditEventsError={auditError}
      definitionSteps={definitionSteps}
      agentEvents={agentEvents}
      backHref={`/${handle}/workflows/${encodeURIComponent(decodedName)}`}
      stepConfigMap={stepConfigMap}
      runDetailHref={`/${handle}/workflows/${encodeURIComponent(decodedName)}/runs/${runId}`}
    />
  );
}
