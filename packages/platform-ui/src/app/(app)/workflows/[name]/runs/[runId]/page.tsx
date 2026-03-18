'use client';

import { useParams } from 'next/navigation';
import { useMemo } from 'react';
import type { StepExecution, AuditEvent, Step } from '@mediforce/platform-core';
import { useProcessInstance, useSubcollection } from '@/hooks/use-process-instances';
import { useAuditEvents } from '@/hooks/use-audit-events';
import { useProcessDefinitionVersions } from '@/hooks/use-process-definitions';
import { useProcessConfig } from '@/hooks/use-process-config';
import { ProcessDetail } from '@/components/processes/process-detail';

type AuditEventWithId = AuditEvent & { id: string };
type StepExecutionWithId = StepExecution;

export default function RunDetailPage() {
  const { name, runId } = useParams<{ name: string; runId: string }>();

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
  const { versions, loading: definitionLoading } = useProcessDefinitionVersions(decodedName);

  // Find the definition version matching the instance's definitionVersion
  // versions are ProcessDefinitionDoc[] which include all ProcessDefinition fields including steps
  const definitionSteps = useMemo((): Step[] => {
    if (!instance || !versions.length) return [];
    const matchingVersion = versions.find((v) => v.version === instance.definitionVersion);
    return matchingVersion?.steps ?? [];
  }, [instance, versions]);

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

  void definitionLoading;

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
      backHref={`/workflows/${encodeURIComponent(decodedName)}`}
      backLabel={decodedName}
      stepConfigMap={stepConfigMap}
      runDetailHref={`/workflows/${encodeURIComponent(decodedName)}/runs/${runId}`}
    />
  );
}
