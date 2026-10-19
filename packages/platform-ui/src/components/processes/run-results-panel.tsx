'use client';

import * as React from 'react';
import { CheckCircle2 } from 'lucide-react';
import type { StepExecution } from '@mediforce/platform-core';
import { formatStepName } from '@/lib/format';
import { StepOutputViewer } from '@/components/agents/step-output-viewer';

interface RunResultsPanelProps {
  runId: string;
  stepExecutions: StepExecution[];
}

function findFinalAgentOutput(stepExecutions: StepExecution[]): {
  stepId: string;
  result: Record<string, unknown> | null;
} | null {
  const withAgent = stepExecutions
    .filter((exec) => exec.status === 'completed' && exec.agentOutput !== undefined)
    .sort((a, b) => {
      const aTime = a.completedAt ? new Date(a.completedAt).getTime() : 0;
      const bTime = b.completedAt ? new Date(b.completedAt).getTime() : 0;
      return bTime - aTime;
    });

  const last = withAgent[0];
  if (!last) return null;

  return {
    stepId: last.stepId,
    result: last.output,
  };
}

export function RunResultsPanel({ runId, stepExecutions }: RunResultsPanelProps) {
  const finalOutput = React.useMemo(
    () => findFinalAgentOutput(stepExecutions),
    [stepExecutions],
  );

  if (!finalOutput) return null;

  const { stepId, result } = finalOutput;

  return (
    <div className="rounded-lg border bg-card">
      <div className="px-4 py-3 border-b bg-green-50/50 dark:bg-green-900/10">
        <div className="flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4 text-green-500" />
          <span className="text-sm font-medium">Results</span>
          <span className="text-xs text-muted-foreground">
            from {formatStepName(stepId)}
          </span>
        </div>
      </div>

      <StepOutputViewer result={result} runId={runId} stepId={stepId} runStatus="completed" />
    </div>
  );
}
