'use client';

import { useParams } from 'next/navigation';
import { useMemo } from 'react';
import type { StepExecution } from '@mediforce/platform-core';
import { useAgentRun } from '@/hooks/use-agent-runs';
import { useProcessInstance, useSubcollection } from '@/hooks/use-process-instances';
import { AgentRunDetail } from '@/components/agents/agent-run-detail';

export default function AgentRunDetailPage() {
  const { runId } = useParams<{ runId: string }>();
  const { data: run, loading } = useAgentRun(runId ?? null);

  // Fetch process instance for definition name
  const { data: processInstance, loading: piLoading } = useProcessInstance(
    run?.processInstanceId ?? null,
  );

  // Fetch step executions to find input data (previous step output)
  const parentPath = run ? `processInstances/${run.processInstanceId}` : '';
  const { data: stepExecutions, loading: seLoading } = useSubcollection<StepExecution>(
    parentPath,
    'stepExecutions',
  );

  // Find the step execution whose gateResult.next === run.stepId (the previous step)
  const inputData = useMemo(() => {
    if (!run || stepExecutions.length === 0) return null;
    const prevExec = stepExecutions.find(
      (se) => se.gateResult?.next === run.stepId,
    );
    return prevExec?.output ?? null;
  }, [run, stepExecutions]);

  if (loading || piLoading || seLoading) {
    return (
      <div className="p-6 space-y-4">
        <div className="h-4 w-20 rounded bg-muted animate-pulse" />
        <div className="h-8 w-2/3 rounded bg-muted animate-pulse" />
        <div className="h-40 rounded bg-muted animate-pulse" />
        <div className="h-40 rounded bg-muted animate-pulse" />
      </div>
    );
  }

  if (!run) {
    return (
      <div className="p-6 text-center text-sm text-muted-foreground">
        Agent run not found.
      </div>
    );
  }

  return (
    <AgentRunDetail
      run={run}
      processInstance={processInstance}
      inputData={inputData}
    />
  );
}
