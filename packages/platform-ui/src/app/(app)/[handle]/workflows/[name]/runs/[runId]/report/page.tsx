'use client';

import { useParams } from 'next/navigation';
import { useMemo } from 'react';
import { useProcessInstance } from '@/hooks/use-process-instances';
import { useStepExecutions } from '@/hooks/use-step-executions';
import { useAuditEvents } from '@/hooks/use-audit-events';
import { useWorkflowVersion } from '@/hooks/use-workflow-versions';
import { RunReport } from '@/components/reports/run-report';

export default function RunReportPage() {
  const { name, runId, handle } = useParams<{ name: string; runId: string; handle: string }>();

  const decodedName = name ? decodeURIComponent(name) : '';

  const { data: instance, loading: instanceLoading } = useProcessInstance(runId ?? null);
  const { data: stepExecutions } = useStepExecutions(runId ?? null, instance?.status);
  const { data: auditEvents } = useAuditEvents(runId ?? null);

  const runVersion = instance ? Number.parseInt(instance.definitionVersion, 10) : null;
  const { definition: runDefinition } = useWorkflowVersion(
    decodedName,
    handle,
    Number.isNaN(runVersion) ? null : runVersion,
  );
  const definitionSteps = useMemo(() => runDefinition?.steps ?? [], [runDefinition]);

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
    return <div className="p-6 text-center text-sm text-muted-foreground">Run not found.</div>;
  }

  if (instance.status !== 'completed') {
    return (
      <div className="p-6 text-center text-sm text-muted-foreground">Report is only available for completed runs.</div>
    );
  }

  return (
    <RunReport
      instance={instance}
      stepExecutions={stepExecutions}
      auditEvents={auditEvents}
      definitionSteps={definitionSteps}
      runDetailHref={`/${handle}/workflows/${encodeURIComponent(decodedName)}/runs/${runId}`}
    />
  );
}
