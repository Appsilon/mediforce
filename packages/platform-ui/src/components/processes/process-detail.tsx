'use client';

import * as React from 'react';
import Link from 'next/link';
import { format } from 'date-fns';
import { ArrowLeft, FileBarChart, Archive, ArchiveRestore } from 'lucide-react';
import type { ProcessInstance, StepExecution, AuditEvent, Step } from '@mediforce/platform-core';
import { ProcessStatusBadge } from './process-status-badge';
import { AuditLogTab } from './audit-log-tab';
import { StepStatusPanel } from './step-status-panel';
import { AgentLogViewer } from './agent-log-viewer';
import { RunResultsPanel } from './run-results-panel';
import { cancelProcessRun, archiveProcessRun } from '@/app/actions/processes';
import { useActiveCoworkSession } from '@/hooks/use-tasks';
import { useProcessInstance } from '@/hooks/use-process-instances';
import { useHandleFromPath } from '@/hooks/use-handle-from-path';
import { routes } from '@/lib/routes';
import { useActiveTaskForInstance } from '@/hooks/use-tasks';
import { useBackNavigation } from '@/hooks/use-back-navigation';
import { formatStepName } from '@/components/tasks/task-utils';
import { MissingEnvBanner } from './missing-env-banner';
import { AgentEscalatedBanner } from './agent-escalated-banner';
import { PreviousRunBanner } from './previous-run-banner';
import { formatDuration } from '@/lib/format';
import { getWorkflowStatus } from '@/lib/workflow-status';

type AuditEventWithId = AuditEvent & { id: string };

function resolveStepLabel(stepId: string, steps: Step[]): string {
  const found = steps.find((s) => s.id === stepId);
  return found?.name ?? stepId.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

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
  auditEvents,
  auditEventsLoading,
  auditEventsError,
  definitionSteps = [],
  agentEvents = [],
  backHref = '/processes',
  stepConfigMap,
  runDetailHref,
}: {
  instance: ProcessInstance;
  stepExecutions: StepExecution[];
  auditEvents: AuditEventWithId[];
  auditEventsLoading: boolean;
  auditEventsError?: Error | null;
  definitionSteps?: Step[];
  agentEvents?: AgentEventItem[];
  backHref?: string;
  stepConfigMap?: Map<string, Record<string, unknown>>;
  /** Href for this run's detail page, used to build step detail links. */
  runDetailHref?: string;
}) {
  const handle = useHandleFromPath();
  const { goBack } = useBackNavigation(backHref);
  const wfStatus = getWorkflowStatus(instance);
  const needsHumanTaskAction = wfStatus.rawReason === 'waiting_for_human' || wfStatus.rawReason === 'awaiting_agent_approval';
  const { task: blockingTask } = useActiveTaskForInstance(
    needsHumanTaskAction ? instance.id : null,
  );
  const needsCowork = wfStatus.rawReason === 'cowork_in_progress';
  const { session: coworkSession } = useActiveCoworkSession(
    needsCowork ? instance.id : null,
  );

  // Probe the source run of a carry-over chain so the banner can render an
  // "archived" variant (plain text, no link) when the source has been deleted
  // or tombstoned. Optimistic (linked) while loading to avoid flicker on the
  // common case where the source is still alive.
  const { data: sourceInstance, loading: sourceLoading } = useProcessInstance(
    instance.previousRunSourceId ?? null,
  );
  const sourceArchived =
    instance.previousRunSourceId !== undefined
    && sourceLoading === false
    && (sourceInstance === null || sourceInstance.deleted === true);

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

    const stepOrder = new Map(definitionSteps.map((s, i) => [s.id, i]));
    return unsorted.sort((a, b) => (stepOrder.get(a.stepId) ?? 0) - (stepOrder.get(b.stepId) ?? 0));
  }, [agentEvents, definitionSteps]);

  const [rightTab, setRightTab] = React.useState<string>(() =>
    agentLogFiles.length > 0 ? 'agent-log' : 'audit',
  );

  // When a new agent log file appears (new step started), switch to Agent Log.
  // Only switch when the count increases so the user's manual tab choice is
  // respected mid-run.
  const prevLogFilesLengthRef = React.useRef(agentLogFiles.length);
  React.useEffect(() => {
    const prev = prevLogFilesLengthRef.current;
    prevLogFilesLengthRef.current = agentLogFiles.length;
    if (agentLogFiles.length > prev) {
      setRightTab('agent-log');
    }
  }, [agentLogFiles.length]);

  const [agentLogStepId, setAgentLogStepId] = React.useState<string | null>(null);

  // Cancel double-confirm: 0 = idle, 1 = first confirm shown, 2 = cancelling in progress
  const [cancelStep, setCancelStep] = React.useState<0 | 1 | 2>(0);
  const [cancelError, setCancelError] = React.useState<string | null>(null);

  const canCancel = wfStatus.displayStatus === 'in_progress' || wfStatus.displayStatus === 'waiting_for_human';
  const canArchive = wfStatus.displayStatus === 'completed' || wfStatus.displayStatus === 'error';
  const [archiving, setArchiving] = React.useState(false);

  async function handleArchiveToggle() {
    setArchiving(true);
    await archiveProcessRun(instance.id, instance.archived !== true);
    setArchiving(false);
  }

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

  const runDurationMs = React.useMemo(() => {
    const start = new Date(instance.createdAt).getTime();
    const end = instance.updatedAt
      ? new Date(instance.updatedAt).getTime()
      : Date.now();
    return end - start;
  }, [instance.createdAt, instance.updatedAt]);

  // Scroll audit log to bottom when events change
  const auditScrollRef = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    if (rightTab === 'audit' && auditScrollRef.current) {
      auditScrollRef.current.scrollTop = auditScrollRef.current.scrollHeight;
    }
  }, [auditEvents, rightTab]);

  return (
    <div className="flex gap-6 p-6 items-start">
      {/* Left panel */}
      <div className="flex-1 min-w-0 space-y-6">
        {/* Back */}
        <button onClick={goBack} className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors">
          <ArrowLeft className="h-4 w-4" />
          Back
        </button>

        {/* Header */}
        <div className="space-y-2">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-headline font-semibold flex-1">{formatStepName(instance.definitionName)}</h1>
            {canArchive && (
              <button
                onClick={handleArchiveToggle}
                disabled={archiving}
                title={instance.archived === true ? 'Unarchive run' : 'Archive run'}
                className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors shrink-0 disabled:opacity-50"
              >
                {instance.archived === true
                  ? <><ArchiveRestore className="h-3.5 w-3.5" />Unarchive</>
                  : <><Archive className="h-3.5 w-3.5" />Archive</>}
              </button>
            )}
            {canCancel && cancelStep === 0 && (
              <button
                onClick={() => setCancelStep(1)}
                className="rounded-md border border-border px-2.5 py-1 text-xs text-muted-foreground hover:text-destructive hover:border-destructive/30 transition-colors shrink-0"
              >
                Cancel
              </button>
            )}
            {canCancel && cancelStep === 1 && (
              <div className="flex items-center gap-1.5 shrink-0">
                <span className="text-xs text-destructive">This cannot be undone.</span>
                <button
                  onClick={handleConfirmCancel}
                  className="rounded-md bg-destructive px-2.5 py-1 text-xs font-medium text-destructive-foreground hover:bg-destructive/90 transition-colors"
                >
                  Confirm cancel
                </button>
                <button
                  onClick={() => { setCancelStep(0); setCancelError(null); }}
                  className="rounded-md border px-2.5 py-1 text-xs text-muted-foreground hover:bg-muted transition-colors"
                >
                  Keep running
                </button>
              </div>
            )}
            {canCancel && cancelStep === 2 && (
              <span className="text-xs text-muted-foreground shrink-0">Cancelling...</span>
            )}
            {cancelError && (
              <span className="text-xs text-destructive shrink-0">{cancelError}</span>
            )}
          </div>

          {/* Metadata row — status badge, definition, ID, created, duration, report link */}
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground items-center">
            <ProcessStatusBadge status={instance.status} pauseReason={instance.pauseReason} />
            {instance.archived === true && (
              <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                <Archive className="h-3 w-3" />
                Archived
              </span>
            )}
            <span>Definition: <span className="font-mono text-foreground">v{instance.definitionVersion}</span></span>
            {instance.configName && (
              <span>Config: <span className="font-mono text-foreground">{instance.configName} v{instance.configVersion}</span></span>
            )}
            <span title={instance.id}>ID: <span className="font-mono text-foreground text-xs">{instance.id.slice(0, 8)}</span></span>
            <span>Created: <span className="text-foreground">{format(new Date(instance.createdAt), 'MMM d, yyyy HH:mm')}</span></span>
            {wfStatus.displayStatus !== 'in_progress' && (
              <span>Duration: <span className="text-foreground">{formatDuration(runDurationMs)}</span></span>
            )}
            {instance.status === 'completed' && (
              <Link
                href={`/${handle}/workflows/${encodeURIComponent(instance.definitionName)}/runs/${instance.id}/report`}
                className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline font-medium"
              >
                <FileBarChart className="h-3.5 w-3.5" />
                View Report
              </Link>
            )}
          </div>

          {needsHumanTaskAction && blockingTask && (
            <div className="rounded-lg border border-primary/20 bg-primary/5 dark:bg-primary/10 px-4 py-3 flex items-center justify-between gap-3">
              <div className="text-sm">
                <span className="font-medium">Waiting for your input</span>
                <span className="text-muted-foreground ml-1.5">
                  — {resolveStepLabel(blockingTask.stepId, definitionSteps)}
                </span>
              </div>
              <Link
                href={routes.task(handle, blockingTask.id)}
                className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors shrink-0"
              >
                Open task
              </Link>
            </div>
          )}
          {needsCowork && coworkSession && (
            <div className="rounded-lg border border-primary/20 bg-primary/5 dark:bg-primary/10 px-4 py-3 flex items-center justify-between gap-3">
              <div className="text-sm">
                <span className="font-medium">Ready to collaborate</span>
                <span className="text-muted-foreground ml-1.5">
                  — {resolveStepLabel(coworkSession.stepId, definitionSteps)}
                </span>
              </div>
              <Link
                href={`/${handle}/cowork/${coworkSession.id}`}
                className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors shrink-0"
              >
                Open co-work
              </Link>
            </div>
          )}
          {wfStatus.hasDedicatedBanner && instance.error && (
            <MissingEnvBanner
              instanceId={instance.id}
              errorJson={instance.error}
              workflowName={instance.definitionName}
            />
          )}
          {wfStatus.displayStatus === 'waiting_for_human' && !needsHumanTaskAction && !needsCowork && (
            <div className="rounded-md bg-amber-50 border border-amber-200 dark:bg-amber-900/20 dark:border-amber-800 px-3 py-2 text-sm text-amber-800 dark:text-amber-300">
              {wfStatus.reason}
            </div>
          )}
          {wfStatus.rawReason === 'agent_escalated' && instance.error && instance.currentStepId && (
            <AgentEscalatedBanner instanceId={instance.id} stepId={instance.currentStepId} />
          )}
          {wfStatus.displayStatus === 'error' && !wfStatus.hasDedicatedBanner && (
            <div className="rounded-md bg-red-50 border border-red-200 dark:bg-red-900/20 dark:border-red-800 px-3 py-2">
              <pre className="text-sm font-mono text-red-800 dark:text-red-300 whitespace-pre-wrap break-all select-text leading-relaxed">
                {wfStatus.reason}
              </pre>
            </div>
          )}
          {instance.previousRun !== undefined && (
            <PreviousRunBanner
              values={instance.previousRun}
              sourceId={instance.previousRunSourceId}
              sourceHref={
                instance.previousRunSourceId !== undefined
                  ? `/${handle}/workflows/${instance.definitionName}/runs/${instance.previousRunSourceId}`
                  : undefined
              }
              sourceArchived={sourceArchived}
            />
          )}
        </div>

        {/* Results — at top of left panel when available */}
        {instance.status === 'completed' && (
          <RunResultsPanel stepExecutions={stepExecutions} />
        )}

        {/* Step Status Panel */}
        {definitionSteps.length > 0 && (
          <StepStatusPanel
            instance={instance}
            definitionSteps={definitionSteps}
            stepExecutions={stepExecutions}
            agentEvents={agentEvents}
            stepConfigMap={stepConfigMap}
            stepDetailBaseHref={runDetailHref}
            onAgentLogClick={agentLogFiles.length > 0 ? (stepId: string) => {
              setAgentLogStepId(stepId);
              setRightTab('agent-log');
            } : undefined}
          />
        )}
      </div>

      {/* Right panel — Agent Log + Audit Log, sticky full-height */}
      <div className="flex-1 min-w-0 sticky top-4 flex flex-col h-[calc(100vh-2rem)]">
        {/* Tab bar */}
        <div className="flex gap-1 border-b shrink-0">
          {[
            ...(agentLogFiles.length > 0 ? [{ value: 'agent-log', label: 'Agent Log' }] : []),
            { value: 'audit', label: 'Audit Log' },
          ].map(({ value, label }) => (
            <button
              key={value}
              onClick={() => setRightTab(value)}
              className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
                rightTab === value
                  ? 'border-primary text-primary'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Agent Log — flex-fills remaining height, internal scroll handles auto-scroll-to-bottom */}
        <div className={`flex-1 min-h-0 pt-4 ${rightTab === 'agent-log' ? 'flex flex-col overflow-hidden' : 'hidden'}`}>
          <AgentLogViewer logFiles={agentLogFiles} initialStepId={agentLogStepId} />
        </div>

        {/* Audit Log — outer div scrolls, effect scrolls to bottom on updates */}
        <div
          ref={auditScrollRef}
          className={`flex-1 min-h-0 overflow-y-auto pt-4 ${rightTab === 'audit' ? '' : 'hidden'}`}
        >
          <AuditLogTab events={auditEvents} loading={auditEventsLoading} error={auditEventsError} />
        </div>
      </div>
    </div>
  );
}
