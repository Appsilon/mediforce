'use client';

import { useParams } from 'next/navigation';
import { useMemo } from 'react';
import type { StepExecution, AuditEvent, Step } from '@mediforce/platform-core';
import { useProcessInstance, useSubcollection } from '@/hooks/use-process-instances';
import { useAuditEvents } from '@/hooks/use-audit-events';
import { useProcessDefinitionVersions } from '@/hooks/use-process-definitions';
import { useWorkflowDefinitions } from '@/hooks/use-workflow-definitions';
import { useProcessConfig } from '@/hooks/use-process-config';
import { ProcessDetail } from '@/components/processes/process-detail';
import { resolveDefinitionSteps } from '@/lib/resolve-definition-steps';

type AuditEventWithId = AuditEvent & { id: string };
type StepExecutionWithId = StepExecution;

export default function RunDetailPage() {
  const { name, runId, handle } = useParams<{ name: string; runId: string; handle: string }>();

  const decodedName = name ? decodeURIComponent(name) : '';

  const { data: instance, loading: instanceLoading } = useProcessInstance(runId ?? null);
  const { data: stepExecutions, loading: stepsLoading } = useSubcollection<StepExecutionWithId>(
    runId ? `processInstances/${runId}` : '',
    'stepExecutions',
  );
  const { data: agentEvents } = useSubcollection<{ id: string; stepId: string; type: string; payload: unknown; sequence: number }>(
    runId ? `processInstances/${runId}` : '',
    'agentEvents',
  );
  const { data: auditEvents, loading: auditLoading, error: auditError } = useAuditEvents(runId ?? null);

  // Load process definition to get steps for the StepStatusPanel
  // Try both legacy processDefinitions and new workflowDefinitions
  const { versions: legacyVersions } = useProcessDefinitionVersions(decodedName);
  const { definitions: workflowVersions } = useWorkflowDefinitions(decodedName);

  const definitionSteps = useMemo(
    () => resolveDefinitionSteps(instance, legacyVersions, workflowVersions),
    [instance, legacyVersions, workflowVersions],
  );

  // Load ProcessConfig to get per-step autonomy levels (3-part key)
  const { data: processConfig } = useProcessConfig(
    instance?.definitionName ?? null,
    instance?.configName ?? null,
    instance?.configVersion ?? null,
  );

  const stepConfigMap = useMemo(() => {
    if (!processConfig?.stepConfigs) return undefined;
    return new Map(
      processConfig.stepConfigs.map((sc) => [
        sc.stepId,
        {
          executorType: sc.executorType,
          autonomyLevel: sc.autonomyLevel,
          plugin: sc.plugin,
          model: sc.model,
          confidenceThreshold: sc.confidenceThreshold,
          fallbackBehavior: sc.fallbackBehavior,
          timeoutMinutes: sc.timeoutMinutes,
          reviewerType: sc.reviewerType,
          agentConfig: sc.agentConfig,
        },
      ]),
    );
  }, [processConfig]);


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
      stepExecutionsLoading={stepsLoading}
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
