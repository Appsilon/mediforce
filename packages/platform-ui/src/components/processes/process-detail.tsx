'use client';

import * as React from 'react';
import Link from 'next/link';
import { format } from 'date-fns';
import { ArrowLeft, FileBarChart } from 'lucide-react';
import * as Tabs from '@radix-ui/react-tabs';
import type { ProcessInstance, StepExecution, AuditEvent, Step } from '@mediforce/platform-core';
import { ProcessStatusBadge } from './process-status-badge';
import { StepHistoryTabs } from './step-history-tabs';
import { AuditLogTab } from './audit-log-tab';
import { StepStatusPanel } from './step-status-panel';
import { AgentLogViewer } from './agent-log-viewer';
import { RunResultsPanel } from './run-results-panel';
import { cancelProcessRun } from '@/app/actions/processes';
import { useHandleFromPath } from '@/hooks/use-handle-from-path';
import { useActiveTaskForInstance } from '@/hooks/use-tasks';

type AuditEventWithId = AuditEvent & { id: string };

export interface AgentEventItem {
  id: string;
  stepId: string;
  type: string;
  payload: unknown;
  sequence: number;
}

export function ProcessDetail({
  instance,
  stepExecutions,
  stepExecutionsLoading,
  auditEvents,
  auditEventsLoading,
  auditEventsError,
  definitionSteps = [],
  agentEvents = [],
  backHref = '/processes',
  backLabel = 'Workflows',
  stepConfigMap,
  runDetailHref,
}: {
  instance: ProcessInstance;
  stepExecutions: StepExecution[];
  stepExecutionsLoading: boolean;
  auditEvents: AuditEventWithId[];
  auditEventsLoading: boolean;
  auditEventsError?: Error | null;
  definitionSteps?: Step[];
  agentEvents?: AgentEventItem[];
  backHref?: string;
  backLabel?: string;
  stepConfigMap?: Map<string, Record<string, unknown>>;
  /** Href for this run's detail page, used to build step detail links. */
  runDetailHref?: string;
}) {
  const handle = useHandleFromPath();
  const needsHumanAction = instance.pauseReason === 'waiting_for_human'
    || instance.pauseReason === 'awaiting_agent_approval';
  const { task: blockingTask } = useActiveTaskForInstance(
    needsHumanAction ? instance.id : null,
  );

  // Extract all agent log filenames from agent status events
  const agentLogFiles = React.useMemo(() => {
    const logEvents = agentEvents.filter(
      (e) => e.type === 'status' && typeof e.payload === 'string' && (e.payload as string).startsWith('agent activity log:'),
    );
    const unsorted = logEvents.map((e) => {
      const fullPath = (e.payload as string).replace('agent activity log: ', '');
      return {
        stepId: e.stepId,
        file: fullPath.split('/').pop() ?? '',
      };
    }).filter((entry) => entry.file.length > 0);

    // Sort tabs to match the definition step order
    const stepOrder = new Map(definitionSteps.map((s, i) => [s.id, i]));
    return unsorted.sort((a, b) => (stepOrder.get(a.stepId) ?? 0) - (stepOrder.get(b.stepId) ?? 0));
  }, [agentEvents, definitionSteps]);

  // Controlled tab state for graph-to-history interaction
  const [activeTab, setActiveTab] = React.useState('history');
  const [agentLogStepId, setAgentLogStepId] = React.useState<string | null>(null);

  // Cancel double-confirm: 0 = idle, 1 = first confirm shown, 2 = cancelling in progress
  const [cancelStep, setCancelStep] = React.useState<0 | 1 | 2>(0);
  const [cancelError, setCancelError] = React.useState<string | null>(null);

  const canCancel = instance.status === 'running' || instance.status === 'paused';

  async function handleConfirmCancel() {
    setCancelStep(2);
    setCancelError(null);
    const result = await cancelProcessRun(instance.id);
    if (!result.success) {
      setCancelError(result.error ?? 'Cancel failed');
      setCancelStep(1);
    } else {
      setCancelStep(0);
    }
  }

  const handleStepClick = React.useCallback((stepId: string) => {
    // Switch to history tab if not already active
    setActiveTab('history');
    // After a brief delay (to allow tab content to render), scroll to the step
    setTimeout(() => {
      const el = document.getElementById(`step-history-${stepId}`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        // Briefly highlight the element
        el.classList.add('ring-2', 'ring-primary', 'ring-offset-2');
        setTimeout(() => el.classList.remove('ring-2', 'ring-primary', 'ring-offset-2'), 2000);
      }
    }, 100);
  }, []);

  return (
    <div className="p-6 space-y-6 max-w-4xl">
      {/* Back */}
      <Link href={backHref} className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors">
        <ArrowLeft className="h-4 w-4" />
        {backLabel}
      </Link>

      {/* Header */}
      <div className="space-y-2">
        <div className="flex items-start gap-3">
          <h1 className="text-2xl font-headline font-semibold flex-1">{instance.definitionName}</h1>
          <ProcessStatusBadge status={instance.status} pauseReason={instance.pauseReason} />
        </div>
        <div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
          <span>Definition: <span className="font-mono text-foreground">v{instance.definitionVersion}</span></span>
          {instance.configName && (
            <span>Config: <span className="font-mono text-foreground">{instance.configName} v{instance.configVersion}</span></span>
          )}
          <span>ID: <span className="font-mono text-foreground text-xs">{instance.id}</span></span>
          {instance.currentStepId && (
            <span>Current step: <span className="font-mono text-foreground">{instance.currentStepId}</span></span>
          )}
          <span>Created: <span className="text-foreground">{format(new Date(instance.createdAt), 'MMM d, yyyy HH:mm')}</span></span>
        </div>
        {instance.pauseReason && (
          <div className="rounded-md bg-amber-50 border border-amber-200 dark:bg-amber-900/20 dark:border-amber-800 px-3 py-2 text-sm text-amber-800 dark:text-amber-300">
            <span>Paused: {instance.pauseReason}</span>
            {blockingTask && (
              <span className="ml-2">
                — waiting on{' '}
                <Link
                  href={`/tasks/${blockingTask.id}`}
                  className="font-medium underline hover:text-amber-900 dark:hover:text-amber-200"
                >
                  {blockingTask.stepId}
                </Link>
                {blockingTask.status === 'claimed' && blockingTask.assignedUserId && (
                  <span className="ml-1 text-amber-600 dark:text-amber-400">(claimed)</span>
                )}
              </span>
            )}
          </div>
        )}
        {instance.error && (
          <div className="rounded-md bg-red-50 border border-red-200 dark:bg-red-900/20 dark:border-red-800 px-3 py-2 text-sm text-red-800 dark:text-red-300">
            Error: {instance.error}
          </div>
        )}

        {/* Cancel button — double-confirm pattern */}
        {canCancel && (
          <div className="flex items-center gap-2 pt-1">
            {cancelStep === 0 && (
              <button
                onClick={() => setCancelStep(1)}
                className="text-sm text-muted-foreground hover:text-destructive transition-colors"
              >
                Cancel run
              </button>
            )}
            {cancelStep === 1 && (
              <div className="flex items-center gap-2 text-sm">
                <span className="text-destructive font-medium">Are you sure? This cannot be undone.</span>
                <button
                  onClick={handleConfirmCancel}
                  className="text-destructive hover:underline font-medium"
                >
                  Yes, cancel run
                </button>
                <button
                  onClick={() => { setCancelStep(0); setCancelError(null); }}
                  className="text-muted-foreground hover:underline"
                >
                  No
                </button>
              </div>
            )}
            {cancelStep === 2 && (
              <span className="text-sm text-muted-foreground">Cancelling...</span>
            )}
            {cancelError && (
              <span className="text-sm text-destructive">{cancelError}</span>
            )}
          </div>
        )}
      </div>

      {/* Step Status Panel — shows all definition steps with live status */}
      {definitionSteps.length > 0 && (
        <StepStatusPanel
          instance={instance}
          definitionSteps={definitionSteps}
          stepExecutions={stepExecutions}
          agentEvents={agentEvents}
          onStepClick={handleStepClick}
          stepConfigMap={stepConfigMap}
          stepDetailBaseHref={runDetailHref}
          onAgentLogClick={agentLogFiles.length > 0 ? (stepId: string) => { setAgentLogStepId(stepId); setActiveTab('agent-log'); } : undefined}
        />
      )}

      {/* Results — shown for completed runs with agent output */}
      {instance.status === 'completed' && (
        <RunResultsPanel stepExecutions={stepExecutions} />
      )}

      {/* View Report — available for all completed runs */}
      {instance.status === 'completed' && (
        <Link
          href={`/${handle}/workflows/${encodeURIComponent(instance.definitionName)}/runs/${instance.id}/report`}
          className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline font-medium"
        >
          <FileBarChart className="h-3.5 w-3.5" />
          View Report
        </Link>
      )}

      {/* Tabs: Step History | Audit Log */}
      <Tabs.Root value={activeTab} onValueChange={setActiveTab}>
        <Tabs.List className="flex gap-1 border-b mb-6">
          {[
            { value: 'history', label: 'Step History' },
            { value: 'audit', label: 'Audit Log' },
            ...(agentLogFiles.length > 0 ? [{ value: 'agent-log', label: 'Agent Log' }] : []),
          ].map(({ value, label }) => (
            <Tabs.Trigger
              key={value}
              value={value}
              className="px-4 py-2 text-sm font-medium text-muted-foreground border-b-2 border-transparent -mb-px transition-colors data-[state=active]:border-primary data-[state=active]:text-primary"
            >
              {label}
            </Tabs.Trigger>
          ))}
        </Tabs.List>

        <Tabs.Content value="history">
          <StepHistoryTabs steps={stepExecutions} loading={stepExecutionsLoading} processInstanceId={instance.id} />
        </Tabs.Content>

        <Tabs.Content value="audit">
          <AuditLogTab events={auditEvents} loading={auditEventsLoading} error={auditEventsError} />
        </Tabs.Content>

        {agentLogFiles.length > 0 && (
          <Tabs.Content value="agent-log">
            <AgentLogViewer logFiles={agentLogFiles} initialStepId={agentLogStepId} />
          </Tabs.Content>
        )}
      </Tabs.Root>
    </div>
  );
}
