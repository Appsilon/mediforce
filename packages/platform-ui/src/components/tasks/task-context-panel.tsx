'use client';

import * as React from 'react';
import * as Collapsible from '@radix-ui/react-collapsible';
import { ChevronDown } from 'lucide-react';
import { useProcessInstance } from '@/hooks/use-process-instances';
import { useStepExecutions } from '@/hooks/use-step-executions';
import { StepOutputViewer } from '@/components/agents/step-output-viewer';

interface TaskContextPanelProps {
  processInstanceId: string;
  stepId: string; // The human task's stepId — we need the PREVIOUS step's output
}

/**
 * Displays the previous step's output in the step's one viewer:
 * `result.json` by default, with every Output File of that step one dropdown
 * pick away.
 *
 * Renders nothing if the previous step produced no output to show.
 */
export function TaskContextPanel({
  processInstanceId,
  stepId,
}: TaskContextPanelProps) {
  const { data: instance } = useProcessInstance(processInstanceId);
  const { data: executions, loading } = useStepExecutions(
    processInstanceId,
    instance?.status,
  );

  // Find the completed step execution that directly precedes this human task's
  // current entry into the review step. On L3 agent-reviewer iteration loops a
  // single review stepId may be entered multiple times — for each entry the
  // reviewer wants to see the output produced just before *that* entry, not
  // before the very first one. So we use the **most recent** start of this
  // review stepId as the boundary: the latest completed execution from a
  // different step with `startedAt <= mostRecentReviewStart` is what triggered
  // the current review iteration.
  const previousStepOutput = React.useMemo(() => {
    if (!executions.length) return null;

    const currentStepExecs = executions
      .filter((e) => e.stepId === stepId)
      .sort((a, b) => new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime());

    // In a loop revisit, the engine hasn't created an execution record for the
    // new active visit yet. All known executions for this step are completed
    // (they belong to past iterations). Use Infinity so the most recent
    // preceding step from the current loop pass is found as context.
    const isLoopRevisitWithNoRecord =
      instance?.currentStepId === stepId &&
      currentStepExecs.every((e) => e.status === 'completed');

    const currentStepStart =
      currentStepExecs.length === 0 || isLoopRevisitWithNoRecord
        ? Infinity
        : new Date(currentStepExecs[currentStepExecs.length - 1].startedAt).getTime();

    const completed = executions
      .filter((e) =>
        e.stepId !== stepId &&
        e.status === 'completed' &&
        e.output !== null &&
        new Date(e.startedAt).getTime() <= currentStepStart,
      )
      .sort((a, b) => new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime());
    return completed.length > 0 ? completed[completed.length - 1] : null;
  }, [executions, stepId]);

  if (loading) {
    return (
      <div className="rounded-lg border p-6">
        <div className="space-y-3">
          <div className="h-4 w-32 rounded bg-muted animate-pulse" />
          <div className="h-24 rounded bg-muted animate-pulse" />
        </div>
      </div>
    );
  }

  if (previousStepOutput === null) {
    return null;
  }

  return (
    <Collapsible.Root defaultOpen={true}>
      <div className="rounded-lg border">
        <Collapsible.Trigger className="w-full flex items-center justify-between px-4 py-3 hover:bg-muted/50 transition-colors">
          <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            Previous Step Output
            <span className="ml-2 font-normal normal-case text-muted-foreground/70">
              ({previousStepOutput.stepId})
            </span>
          </div>
          <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform duration-200 data-[state=open]:rotate-180" />
        </Collapsible.Trigger>
        <Collapsible.Content>
          <StepOutputViewer
            result={previousStepOutput.output}
            runId={processInstanceId}
            stepId={previousStepOutput.stepId}
            runStatus={instance?.status}
          />
        </Collapsible.Content>
      </div>
    </Collapsible.Root>
  );
}
