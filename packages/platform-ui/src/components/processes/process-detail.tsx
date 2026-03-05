'use client';

import * as React from 'react';
import Link from 'next/link';
import { format } from 'date-fns';
import { ArrowLeft } from 'lucide-react';
import * as Tabs from '@radix-ui/react-tabs';
import type { ProcessInstance, StepExecution, AuditEvent, Step } from '@mediforce/platform-core';
import { ProcessStatusBadge } from './process-status-badge';
import { StepHistoryTabs } from './step-history-tabs';
import { AuditLogTab } from './audit-log-tab';
import { StepStatusPanel } from './step-status-panel';
import { cancelProcessRun } from '@/app/actions/processes';

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
  backLabel = 'Processes',
  stepConfigMap,
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
  stepConfigMap?: Map<string, { autonomyLevel?: string; executorType?: string }>;
}) {
  // Controlled tab state for graph-to-history interaction
  const [activeTab, setActiveTab] = React.useState('history');

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
          <span>Version: <span className="font-mono text-foreground">{instance.definitionVersion}</span></span>
          <span>ID: <span className="font-mono text-foreground text-xs">{instance.id}</span></span>
          {instance.currentStepId && (
            <span>Current step: <span className="font-mono text-foreground">{instance.currentStepId}</span></span>
          )}
          <span>Created: <span className="text-foreground">{format(new Date(instance.createdAt), 'MMM d, yyyy HH:mm')}</span></span>
        </div>
        {instance.pauseReason && (
          <div className="rounded-md bg-amber-50 border border-amber-200 dark:bg-amber-900/20 dark:border-amber-800 px-3 py-2 text-sm text-amber-800 dark:text-amber-300">
            Paused: {instance.pauseReason}
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
        />
      )}

      {/* Tabs: Step History | Audit Log */}
      <Tabs.Root value={activeTab} onValueChange={setActiveTab}>
        <Tabs.List className="flex gap-1 border-b mb-6">
          {[
            { value: 'history', label: 'Step History' },
            { value: 'audit', label: 'Audit Log' },
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
          <StepHistoryTabs steps={stepExecutions} loading={stepExecutionsLoading} />
        </Tabs.Content>

        <Tabs.Content value="audit">
          <AuditLogTab events={auditEvents} loading={auditEventsLoading} error={auditEventsError} />
        </Tabs.Content>
      </Tabs.Root>
    </div>
  );
}
