'use client';

import { useParams } from 'next/navigation';
import { useMemo } from 'react';
import type { WorkflowStep } from '@mediforce/platform-core';
import { useProcessInstance } from '@/hooks/use-process-instances';
import { useStepExecutions } from '@/hooks/use-step-executions';
import { useAgentEvents } from '@/hooks/use-agent-events';
import { useAuditEvents } from '@/hooks/use-audit-events';
import { useWorkflowVersion } from '@/hooks/use-workflow-versions';
import { ProcessDetail } from '@/components/processes/process-detail';

export default function RunDetailPage() {
  const { name, runId, handle } = useParams<{ name: string; runId: string; handle: string }>();

  const decodedName = name ? decodeURIComponent(name) : '';

  const { data: instance, loading: instanceLoading } = useProcessInstance(runId ?? null);
  const { data: stepExecutions } = useStepExecutions(runId ?? null, instance?.status);
  const { data: agentEvents } = useAgentEvents(runId ?? null, null, instance?.status);
  const { data: auditEvents, loading: auditLoading, error: auditError } = useAuditEvents(runId ?? null);

  // Load the specific workflow version this run was started against so the
  // StepStatusPanel can render the static step list. `parseInt` accepts
  // `'1'` / `'v1'` shapes; the hook short-circuits on `NaN`.
  const runVersion = instance ? Number.parseInt(instance.definitionVersion, 10) : null;
  const { definition: runDefinition } = useWorkflowVersion(
    decodedName,
    handle,
    Number.isNaN(runVersion) ? null : runVersion,
  );
  const definitionSteps = useMemo(
    () => runDefinition?.steps ?? [],
    [runDefinition],
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
      auditEvents={auditEvents}
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
