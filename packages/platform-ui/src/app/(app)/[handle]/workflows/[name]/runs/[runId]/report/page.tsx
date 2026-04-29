'use client';

import { useParams } from 'next/navigation';
import { useMemo } from 'react';
import type { StepExecution, AuditEvent } from '@mediforce/platform-core';
import { useProcessInstance, useSubcollection } from '@/hooks/use-process-instances';
import { useAuditEvents } from '@/hooks/use-audit-events';
import { useWorkflowDefinitions } from '@/hooks/use-workflow-definitions';
import { resolveDefinitionSteps } from '@/lib/resolve-definition-steps';
import { RunReport } from '@/components/reports/run-report';

type AuditEventWithId = AuditEvent & { id: string };

export default function RunReportPage() {
  const { name, runId, handle } = useParams<{ name: string; runId: string; handle: string }>();

  const decodedName = name ? decodeURIComponent(name) : '';

  const { data: instance, loading: instanceLoading } = useProcessInstance(runId ?? null);
  const { data: stepExecutions } = useSubcollection<StepExecution>(
    runId ? `processInstances/${runId}` : '',
    'stepExecutions',
  );
  const { data: auditEvents } = useAuditEvents(runId ?? null);

  const { definitions: workflowVersions } = useWorkflowDefinitions(decodedName);

  const definitionSteps = useMemo(
    () => resolveDefinitionSteps(instance, workflowVersions),
    [instance, workflowVersions],
  );

  if (instanceLoading) {
    return (
      <div className="p-6 space-y-4 max-w-4xl mx-auto">
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

  if (instance.status !== 'completed') {
    return (
      <div className="p-6 text-center text-sm text-muted-foreground">
        Report is only available for completed runs.
      </div>
    );
  }

  return (
    <RunReport
      instance={instance}
      stepExecutions={stepExecutions}
      auditEvents={auditEvents as AuditEventWithId[]}
      definitionSteps={definitionSteps}
      runDetailHref={`/${handle}/workflows/${encodeURIComponent(decodedName)}/runs/${runId}`}
    />
  );
}
