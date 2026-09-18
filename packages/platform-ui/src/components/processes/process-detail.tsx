'use client';

import * as React from 'react';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { format } from 'date-fns';
import { Archive, ArchiveRestore, CheckCircle2, GitBranch, ScrollText, ShieldCheck, X } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { ProcessInstance, StepExecution, AuditEvent, Step, WorkflowStep, WorkflowDefinition } from '@mediforce/platform-core';
import { ProcessStatusBadge } from './process-status-badge';
import { AuditLogTab } from './audit-log-tab';
import { StepStatusPanel } from './step-status-panel';
import { AgentLogViewer } from './agent-log-viewer';
import { RunResultsPanel } from './run-results-panel';
import { RunOutputFilesPanel } from './run-output-files-panel';
import { ApiError } from '@mediforce/platform-api/client';
import { useActiveCoworkSession } from '@/hooks/use-tasks';
import { useProcessInstance } from '@/hooks/use-process-instances';
import { useRunOutputFiles } from '@/hooks/use-run-output-files';
import { useArchiveRun, useCancelRun } from '@/hooks/use-run-mutations';
import { useHandleFromPath } from '@/hooks/use-handle-from-path';
import { routes } from '@/lib/routes';
import { useActiveTaskForInstance } from '@/hooks/use-tasks';
import { cn } from '@/lib/utils';
import { secondaryButtonClass, destructiveButtonClass } from '@/components/ui/button-styles';
import { RunReport } from '@/components/reports/run-report';
import { MissingEnvBanner } from './missing-env-banner';
import { AgentEscalatedBanner } from './agent-escalated-banner';
import { PreviousRunBanner } from './previous-run-banner';
import { formatDuration, formatCostUsd, formatStepName } from '@/lib/format';
import { getWorkflowStatus } from '@/lib/workflow-status';

const WorkflowDiagram = dynamic(
  () => import('@/components/workflows/workflow-diagram').then((m) => ({ default: m.WorkflowDiagram })),
  { ssr: false, loading: () => <div className="flex items-center justify-center h-full text-sm text-muted-foreground">Loading diagram…</div> },
);

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
  definition,
}: {
  instance: ProcessInstance;
  stepExecutions: StepExecution[];
  auditEvents: AuditEvent[];
  auditEventsLoading: boolean;
  auditEventsError?: Error | null;
  definitionSteps?: Step[];
  agentEvents?: AgentEventItem[];
  backHref?: string;
  stepConfigMap?: Map<string, Record<string, unknown>>;
  /** Href for this run's detail page, used to build step detail links. */
  runDetailHref?: string;
  /** Full workflow definition for the version this run used — powers the diagram tab. */
  definition?: WorkflowDefinition;
}) {
  const handle = useHandleFromPath();
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
    const stepExecutorMap = new Map(definitionSteps.map((s) => [s.id, (s as unknown as WorkflowStep).executor]));
    const unsorted = logEvents.map((e) => {
      const fullPath = (e.payload as string).replace('agent activity log: ', '');
      return {
        stepId: e.stepId,
        file: fullPath.split('/').pop() ?? '',
        executor: stepExecutorMap.get(e.stepId) ?? 'agent',
      };
    }).filter((entry) => entry.file.length > 0);

    const stepOrder = new Map(definitionSteps.map((s, i) => [s.id, i]));
    return unsorted.sort((a, b) => (stepOrder.get(a.stepId) ?? 0) - (stepOrder.get(b.stepId) ?? 0));
  }, [agentEvents, definitionSteps]);

  const runningStepIds = React.useMemo(
    () => new Set(stepExecutions.filter((e) => e.status === 'running').map((e) => e.stepId)),
    [stepExecutions],
  );

  const [rightTab, setRightTab] = React.useState<'agent-log' | 'audit' | 'diagram' | 'report'>(() =>
    agentLogFiles.length > 0 ? 'agent-log' : 'audit',
  );

  // One list for the edge pulls and the panel header, so they cannot drift.
  const rightPanels = React.useMemo((): Array<{
    value: 'agent-log' | 'audit' | 'diagram' | 'report';
    label: string;
    Icon: LucideIcon;
    /** The report only exists once the run finishes, so its pull announces
     *  itself rather than sitting quietly with the other three. */
    ready?: boolean;
  }> => [
    ...(agentLogFiles.length > 0 ? [{ value: 'agent-log' as const, label: 'Log', Icon: ScrollText }] : []),
    { value: 'audit' as const, label: 'Audit', Icon: ShieldCheck },
    ...(definition ? [{ value: 'diagram' as const, label: 'Diagram', Icon: GitBranch }] : []),
    ...(instance.status === 'completed'
      ? [{ value: 'report' as const, label: 'Report', Icon: CheckCircle2, ready: true }]
      : []),
  ], [agentLogFiles.length, definition, instance.status]);

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

  const [logsOpen, setLogsOpen] = React.useState(false);

  // Cancel double-confirm: 0 = idle, 1 = first confirm shown, 2 = cancelling in progress
  const [cancelStep, setCancelStep] = React.useState<0 | 1 | 2>(0);
  const [cancelError, setCancelError] = React.useState<string | null>(null);

  const canCancel = wfStatus.displayStatus === 'in_progress' || wfStatus.displayStatus === 'waiting_for_human';
  const canArchive = wfStatus.displayStatus === 'completed' || wfStatus.displayStatus === 'error' || wfStatus.displayStatus === 'cancelled';
  const [archiving, setArchiving] = React.useState(false);

  const archiveMutation = useArchiveRun();
  const cancelMutation = useCancelRun();

  async function handleArchiveToggle() {
    setArchiving(true);
    try {
      await archiveMutation.mutateAsync({ runId: instance.id, archived: instance.archived !== true });
    } finally {
      setArchiving(false);
    }
  }

  async function handleConfirmCancel() {
    setCancelStep(2);
    setCancelError(null);
    try {
      await cancelMutation.mutateAsync({ runId: instance.id });
      setCancelStep(0);
    } catch (err) {
      const message =
        err instanceof ApiError ? err.message : err instanceof Error ? err.message : 'Cancel failed';
      setCancelError(message);
      setCancelStep(1);
    }
  }

  const runDurationMs = React.useMemo(() => {
    const start = new Date(instance.createdAt).getTime();
    const end = instance.updatedAt
      ? new Date(instance.updatedAt).getTime()
      : Date.now();
    return end - start;
  }, [instance.createdAt, instance.updatedAt]);

  // Computed from step executions (source of truth on detail page).
  // List views use the denormalized instance.totalCostUsd instead —
  // the two can briefly diverge after retries until the next step completes.
  const totalCostUsd = React.useMemo(() => {
    if (!stepExecutions || stepExecutions.length === 0) return null;
    let total = 0;
    let hasCost = false;
    for (const exec of stepExecutions) {
      if (exec.agentOutput?.estimatedCostUsd != null) {
        total += exec.agentOutput.estimatedCostUsd;
        hasCost = true;
      }
    }
    return hasCost ? total : null;
  }, [stepExecutions]);

  const isTerminal = instance.status === 'completed' || instance.status === 'failed';

  const { data: outputFiles } = useRunOutputFiles(instance.id, instance.status);

  // Scroll audit log to bottom when events change
  const auditScrollRef = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    if (rightTab === 'audit' && auditScrollRef.current) {
      auditScrollRef.current.scrollTop = auditScrollRef.current.scrollHeight;
    }
  }, [auditEvents, rightTab]);

  return (
    <div className="flex items-start gap-0 p-6 pr-0">
      <div className="flex-1 min-w-0 space-y-6 pr-6">
        {/* Header */}
        <div className="space-y-2">
          <div className="flex items-center gap-3">
            <h1
              className="text-2xl font-headline font-semibold min-w-0 truncate"
              title={formatStepName(instance.definitionName)}
            >
              {formatStepName(instance.definitionName)}
            </h1>
            <div className="shrink-0 mr-auto flex items-center gap-2">
              <ProcessStatusBadge status={instance.status} pauseReason={instance.pauseReason} error={instance.error} dryRun={instance.dryRun} />
              {instance.archived === true && (
                <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                  <Archive className="h-3 w-3" />
                  Archived
                </span>
              )}
            </div>
            {canArchive && (
              <button
                onClick={handleArchiveToggle}
                disabled={archiving}
                title={instance.archived === true ? 'Unarchive run' : 'Archive run'}
                className={cn(secondaryButtonClass, "shrink-0")}
              >
                {instance.archived === true
                  ? <><ArchiveRestore className="h-3.5 w-3.5" />Unarchive</>
                  : <><Archive className="h-3.5 w-3.5" />Archive</>}
              </button>
            )}
            {canCancel && cancelStep === 0 && (
              <button
                onClick={() => setCancelStep(1)}
                className={cn(secondaryButtonClass, "shrink-0 hover:text-destructive")}
              >
                <X className="h-3.5 w-3.5" />
                Cancel run
              </button>
            )}
            {canCancel && cancelStep === 1 && (
              <div className="flex items-center gap-1.5 shrink-0">
                <span className="text-sm text-destructive">This cannot be undone.</span>
                <button onClick={handleConfirmCancel} className={destructiveButtonClass}>
                  Confirm cancel
                </button>
                <button
                  onClick={() => { setCancelStep(0); setCancelError(null); }}
                  className={secondaryButtonClass}
                >
                  Keep running
                </button>
              </div>
            )}
            {canCancel && cancelStep === 2 && (
              <span className="text-sm text-muted-foreground shrink-0">Cancelling…</span>
            )}
            {cancelError && (
              <span className="text-xs text-destructive shrink-0">{cancelError}</span>
            )}
          </div>

          {/* Run facts. A labelled column each, rather than one sentence that
              wraps: these are numbers people compare across runs, and they were
              unreadable run together with their labels inline. */}
          <dl className="grid grid-flow-col auto-cols-fr gap-px overflow-x-auto rounded-lg border bg-border">
            {wfStatus.displayStatus !== 'in_progress' && (
              <div className="bg-card px-3 py-2">
                <dt className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Duration</dt>
                <dd className="mt-0.5 text-sm font-semibold tabular-nums">{formatDuration(runDurationMs)}</dd>
              </div>
            )}
            {totalCostUsd != null && (
              <div className="bg-card px-3 py-2">
                <dt className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Cost</dt>
                <dd className={cn('mt-0.5 text-sm font-semibold tabular-nums', isTerminal ? '' : 'text-amber-600 dark:text-amber-400')}>
                  {formatCostUsd(totalCostUsd)}{isTerminal ? '' : '+'}
                </dd>
              </div>
            )}
            <div className="bg-card px-3 py-2">
              <dt className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Definition</dt>
              <dd className="mt-0.5 text-sm font-semibold">v{instance.definitionVersion}</dd>
            </div>
            {instance.configName && (
              <div className="bg-card px-3 py-2 min-w-0">
                <dt className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Config</dt>
                <dd className="mt-0.5 truncate font-mono text-xs" title={`${instance.configName} v${instance.configVersion}`}>
                  {instance.configName} v{instance.configVersion}
                </dd>
              </div>
            )}
            <div className="bg-card px-3 py-2 min-w-0">
              <dt className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Run ID</dt>
              <dd className="mt-0.5 truncate font-mono text-xs" title={instance.id}>{instance.id.slice(0, 8)}</dd>
            </div>
            <div className="bg-card px-3 py-2 min-w-0">
              <dt className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Started</dt>
              <dd className="mt-0.5 truncate text-sm font-semibold tabular-nums" title={format(new Date(instance.createdAt), 'MMM d, yyyy HH:mm')}>
                {format(new Date(instance.createdAt), 'MMM d, HH:mm')}
              </dd>
            </div>
          </dl>

          {needsHumanTaskAction && blockingTask && (
            <div className="rounded-lg border border-primary/20 bg-primary/5 dark:bg-primary/10 px-4 py-3 flex items-center justify-between gap-3">
              <div className="text-sm">
                <span className="font-medium">Waiting for your input</span>
                <span className="text-muted-foreground ml-1.5">
                  — {definitionSteps.find((s) => s.id === blockingTask.stepId)?.name ?? formatStepName(blockingTask.stepId)}
                </span>
              </div>
              <Link
                href={routes.workflowRunStep(handle, instance.definitionName, instance.id, blockingTask.stepId)}
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
                  — {definitionSteps.find((s) => s.id === coworkSession.stepId)?.name ?? formatStepName(coworkSession.stepId)}
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

        {/* Results */}
        {instance.status === 'completed' && (
          <RunResultsPanel stepExecutions={stepExecutions} stepConfigMap={stepConfigMap} />
        )}

        {/* Output Files — hidden until the run has at least one */}
        <RunOutputFilesPanel
          runId={instance.id}
          files={outputFiles}
          definitionSteps={definitionSteps}
        />

        {/* Step Status Panel */}
        {definitionSteps.length > 0 && (
          <StepStatusPanel
            instance={instance}
            definitionSteps={definitionSteps}
            stepExecutions={stepExecutions}
            agentEvents={agentEvents}
            stepConfigMap={stepConfigMap}
            outputFiles={outputFiles}
            stepDetailBaseHref={runDetailHref}
            currentTask={blockingTask}
            onAgentLogClick={(stepId: string) => {
              setAgentLogStepId(stepId);
              if (agentLogFiles.length > 0) setRightTab('agent-log');
              setLogsOpen(true);
            }}
          />
        )}
      </div>

      {/* Right panel. The pulls down the edge are the only switcher — open or
          closed, they sit in the same place and say what is behind them. A
          second row of tabs inside meant two controls for one job. */}
      <div
        className={cn(
          'sticky top-4 h-[calc(100vh-2rem)] shrink-0 flex gap-0 transition-[width] duration-300 ease-in-out',
          logsOpen ? 'w-1/2' : 'w-8',
        )}
      >
        <div className="w-8 shrink-0 flex flex-col items-end justify-center gap-1.5">
          {rightPanels.map(({ value, label, Icon, ready }) => {
            const active = logsOpen && rightTab === value;
            return (
              <button
                key={value}
                onClick={() => {
                  if (active) {
                    setLogsOpen(false);
                    return;
                  }
                  setRightTab(value);
                  setLogsOpen(true);
                }}
                className={cn(
                  'flex flex-col items-center gap-1.5 rounded-l-md border border-r-0 px-2 py-3 text-xs font-medium tracking-wide whitespace-nowrap transition-colors',
                  active && 'bg-card text-foreground border-border',
                  !active && ready === true && 'bg-primary-subtle text-primary border-primary/30 hover:brightness-95',
                  !active && ready !== true && 'bg-muted/60 text-muted-foreground border-transparent hover:text-foreground hover:bg-muted',
                )}
              >
                {/* Turned with the label, which `vertical-rl` rotates 90°. */}
                <Icon className={cn('h-3.5 w-3.5 shrink-0 rotate-90', ready === true && 'text-primary')} />
                <span style={{ writingMode: 'vertical-rl' }}>{label}</span>
              </button>
            );
          })}
        </div>

        <div
          className={cn(
            'flex-1 flex flex-col min-h-0 min-w-0 overflow-hidden rounded-l-lg border bg-card shadow-sm transition-opacity duration-200',
            logsOpen ? 'opacity-100' : 'opacity-0 pointer-events-none',
          )}
        >
          <div className="flex items-center gap-2 px-4 py-2.5 border-b shrink-0">
            {(() => {
              const panel = rightPanels.find((entry) => entry.value === rightTab);
              if (panel === undefined) return null;
              return (
                <>
                  <panel.Icon className={cn('h-4 w-4 shrink-0', panel.ready === true ? 'text-primary' : 'text-muted-foreground')} />
                  <h2 className="font-headline text-sm font-semibold truncate">{panel.label}</h2>
                </>
              );
            })()}
            <button
              onClick={() => setLogsOpen(false)}
              className="ml-auto shrink-0 rounded-md p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              title="Close panel"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className={cn('flex-1 min-h-0 p-4 flex flex-col overflow-hidden', rightTab !== 'agent-log' && 'hidden')}>
            <AgentLogViewer
              logFiles={agentLogFiles}
              initialStepId={agentLogStepId}
              runningStepIds={runningStepIds}
              runActive={isTerminal === false}
            />
          </div>

          <div
            ref={auditScrollRef}
            className={cn('flex-1 min-h-0 overflow-y-auto p-4', rightTab !== 'audit' && 'hidden')}
          >
            <AuditLogTab
              events={auditEvents}
              loading={auditEventsLoading}
              error={auditEventsError}
              printable={rightTab === 'audit'}
            />
          </div>

          <div className={cn('flex-1 min-h-0 overflow-auto grid place-items-center p-4', rightTab !== 'diagram' && 'hidden')}>
            {definition && rightTab === 'diagram' && (
              <WorkflowDiagram definition={definition} className="w-full" />
            )}
          </div>

          {/* Same component as the standalone report page. */}
          <div className={cn('flex-1 min-h-0 overflow-y-auto', rightTab !== 'report' && 'hidden')}>
            {rightTab === 'report' && (
              <RunReport
                instance={instance}
                stepExecutions={stepExecutions}
                auditEvents={auditEvents}
                definitionSteps={definitionSteps}
                runDetailHref={routes.workflowRun(handle, instance.definitionName, instance.id)}
                embedded
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
