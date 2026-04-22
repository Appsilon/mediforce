'use client';

import * as React from 'react';
import { useAuth } from '@/contexts/auth-context';
import Image from 'next/image';
import Link from 'next/link';
import { format } from 'date-fns';
import {
  ArrowLeft,
  Printer,
  Clock,
  Timer,
  Gauge,
  Bot,
  User,
  CheckCircle2,
  XCircle,
  AlertCircle,
  GitBranch,
  ExternalLink,
  FileText,
} from 'lucide-react';
import type {
  ProcessInstance,
  StepExecution,
  AuditEvent,
  Step,
  AgentOutputSnapshot,
} from '@mediforce/platform-core';
import { ProcessStatusBadge } from '@/components/processes/process-status-badge';
import {
  formatDuration,
  formatStepName,
  computeWallClockDuration,
  computeActiveProcessingTime,
} from '@/lib/format';
import { cn } from '@/lib/utils';

type DetailLevel = 'brief' | 'full';

interface RunReportProps {
  instance: ProcessInstance;
  stepExecutions: StepExecution[];
  auditEvents: Array<AuditEvent & { id: string }>;
  definitionSteps: Step[];
  runDetailHref: string;
}

const STEP_STATUS_ICONS: Record<string, React.ReactNode> = {
  completed: <CheckCircle2 className="h-4 w-4 text-green-500" />,
  failed: <XCircle className="h-4 w-4 text-red-500" />,
  running: <AlertCircle className="h-4 w-4 text-blue-500" />,
  paused: <AlertCircle className="h-4 w-4 text-amber-500" />,
  pending: <AlertCircle className="h-4 w-4 text-gray-400" />,
  escalated: <AlertCircle className="h-4 w-4 text-orange-500" />,
};

const STEP_STATUS_STYLES: Record<string, string> = {
  completed: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
  failed: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
  running: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
  paused: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300',
  pending: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400',
  escalated: 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300',
};

function findFinalAgentOutput(stepExecutions: StepExecution[]): {
  stepId: string;
  output: AgentOutputSnapshot;
  result: Record<string, unknown> | null;
} | null {
  const withAgent = stepExecutions
    .filter((exec) => exec.status === 'completed' && exec.agentOutput !== undefined && exec.agentOutput !== null)
    .sort((a, b) => {
      const aTime = a.completedAt ? new Date(a.completedAt).getTime() : 0;
      const bTime = b.completedAt ? new Date(b.completedAt).getTime() : 0;
      return bTime - aTime;
    });

  const last = withAgent[0];
  if (!last?.agentOutput) return null;

  return {
    stepId: last.stepId,
    output: last.agentOutput,
    result: last.output,
  };
}

function truncateJson(value: unknown, maxLines: number): { text: string; truncated: boolean } {
  const full = JSON.stringify(value, null, 2);
  const lines = full.split('\n');
  if (lines.length <= maxLines) {
    return { text: full, truncated: false };
  }
  return { text: lines.slice(0, maxLines).join('\n'), truncated: true };
}

function getStepName(stepId: string, definitionSteps: Step[]): string {
  const definition = definitionSteps.find((s) => s.id === stepId);
  return definition?.name ?? formatStepName(stepId);
}

function getStepDuration(step: StepExecution): number | null {
  if (step.completedAt === null || step.startedAt === null) return null;
  return new Date(step.completedAt).getTime() - new Date(step.startedAt).getTime();
}

export function RunReport({
  instance,
  stepExecutions,
  auditEvents,
  definitionSteps,
  runDetailHref,
}: RunReportProps) {
  const [detailLevel, setDetailLevel] = React.useState<DetailLevel>('brief');

  const runDate = format(new Date(instance.createdAt), 'yyyy-MM-dd');
  const slugifiedName = instance.definitionName.replace(/\s+/g, '-').toLowerCase();

  React.useEffect(() => {
    const title = `${slugifiedName}_${runDate}_${detailLevel}`;
    document.title = title;
    return () => { document.title = 'Mediforce'; };
  }, [slugifiedName, runDate, detailLevel]);

  const sortedSteps = React.useMemo(
    () => [...stepExecutions].sort(
      (a, b) => new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime(),
    ),
    [stepExecutions],
  );

  const wallClock = computeWallClockDuration(instance.createdAt, stepExecutions);
  const activeTime = computeActiveProcessingTime(stepExecutions);
  const finalOutput = React.useMemo(
    () => findFinalAgentOutput(stepExecutions),
    [stepExecutions],
  );

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-8">
      {/* Toolbar */}
      <div className="print:hidden flex items-center justify-between gap-4">
        <Link
          href={runDetailHref}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to run detail
        </Link>

        <div className="flex items-center gap-3">
          <DetailLevelToggle value={detailLevel} onChange={setDetailLevel} />
          <button
            onClick={() => window.print()}
            className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-muted transition-colors"
          >
            <Printer className="h-4 w-4" />
            Print
          </button>
        </div>
      </div>

      {/* Report Header */}
      <ReportHeader
        instance={instance}
        wallClock={wallClock}
        activeTime={activeTime}
      />

      {/* Step Timeline */}
      <section>
        <h2 className="text-lg font-headline font-semibold mb-4">Step Timeline</h2>
        <ol className="space-y-3">
          {sortedSteps.map((step, index) => (
            <StepCard
              key={step.id}
              step={step}
              index={index}
              detailLevel={detailLevel}
              definitionSteps={definitionSteps}
              auditEvents={auditEvents}
            />
          ))}
        </ol>
      </section>

      {/* Deliverables */}
      <DeliverablesSection finalOutput={finalOutput} />

      {/* Footer */}
      <ReportFooter />
    </div>
  );
}

function DetailLevelToggle({
  value,
  onChange,
}: {
  value: DetailLevel;
  onChange: (level: DetailLevel) => void;
}) {
  const levels: DetailLevel[] = ['brief', 'full'];

  return (
    <div className="flex rounded-md overflow-hidden border">
      {levels.map((level) => (
        <button
          key={level}
          onClick={() => onChange(level)}
          className={cn(
            'px-3 py-1.5 text-sm font-medium capitalize transition-colors',
            value === level
              ? 'bg-primary text-primary-foreground'
              : 'bg-muted text-muted-foreground hover:bg-muted/80',
          )}
        >
          {level}
        </button>
      ))}
    </div>
  );
}

function ReportHeader({
  instance,
  wallClock,
  activeTime,
}: {
  instance: ProcessInstance;
  wallClock: number | null;
  activeTime: number;
}) {
  return (
    <header className="space-y-4">
      <div className="flex items-start gap-4">
        <Image
          src="/logo.png"
          alt="Mediforce"
          width={40}
          height={40}
          loading="eager"
        />
        <div className="flex-1 space-y-2">
          <h1 className="text-2xl font-headline font-semibold">
            {instance.definitionName} — Run Report
          </h1>
          <p className="text-sm text-muted-foreground">
            Generated: {format(new Date(), 'MMMM d, yyyy')}
          </p>
        </div>
        <ProcessStatusBadge status={instance.status} pauseReason={instance.pauseReason} />
      </div>

      <div className="flex flex-wrap gap-6 text-sm text-muted-foreground">
        {wallClock !== null && (
          <div className="flex items-center gap-1.5">
            <Clock className="h-3.5 w-3.5" />
            <span>Wall-clock: <span className="text-foreground font-medium">{formatDuration(wallClock)}</span></span>
          </div>
        )}
        {activeTime > 0 && (
          <div className="flex items-center gap-1.5">
            <Timer className="h-3.5 w-3.5" />
            <span>Active processing: <span className="text-foreground font-medium">{formatDuration(activeTime)}</span></span>
          </div>
        )}
      </div>
    </header>
  );
}

function StepCard({
  step,
  index,
  detailLevel,
  definitionSteps,
  auditEvents,
}: {
  step: StepExecution;
  index: number;
  detailLevel: DetailLevel;
  definitionSteps: Step[];
  auditEvents: Array<AuditEvent & { id: string }>;
}) {
  const duration = getStepDuration(step);
  const stepName = getStepName(step.stepId, definitionSteps);
  const definition = definitionSteps.find((s) => s.id === step.stepId);
  const hasAgentOutput = step.agentOutput !== undefined && step.agentOutput !== null;
  const isScript = hasAgentOutput && step.agentOutput?.model === 'script';

  const stepAuditEvents = React.useMemo(
    () => auditEvents
      .filter((event) => event.stepId === step.stepId)
      .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
      .slice(0, 5),
    [auditEvents, step.stepId],
  );

  return (
    <li className="report-step rounded-lg border bg-card" style={{ breakInside: 'avoid' }}>
      <div className="p-4 space-y-3">
        {/* Always visible: name, duration, status */}
        <div className="flex items-center gap-3">
          <span className="flex items-center justify-center w-6 h-6 rounded-full bg-muted text-xs font-medium">
            {index + 1}
          </span>
          {STEP_STATUS_ICONS[step.status] ?? STEP_STATUS_ICONS.pending}
          <span className="font-medium flex-1">{stepName}</span>
          {duration !== null && (
            <span className="text-sm text-muted-foreground">{formatDuration(duration)}</span>
          )}
          <span className={cn(
            'inline-flex rounded-full px-2 py-0.5 text-xs font-medium capitalize',
            STEP_STATUS_STYLES[step.status] ?? STEP_STATUS_STYLES.pending,
          )}>
            {step.status}
          </span>
        </div>

        {/* Metadata: confidence, model, executor type */}
        <div className="flex flex-wrap gap-4 text-sm text-muted-foreground pl-9">
          {hasAgentOutput && !isScript && step.agentOutput?.confidence !== undefined && step.agentOutput.confidence !== null && (
            <div className="flex items-center gap-1.5">
              <Gauge className="h-3.5 w-3.5" />
              <span className="text-muted-foreground">AI&nbsp;confidence:</span>
              <span className={cn(
                'font-medium',
                Math.round(step.agentOutput.confidence * 100) >= 80
                  ? 'text-green-600 dark:text-green-400'
                  : Math.round(step.agentOutput.confidence * 100) >= 50
                    ? 'text-amber-600 dark:text-amber-400'
                    : 'text-red-600 dark:text-red-400',
              )}>
                {Math.round(step.agentOutput.confidence * 100)}%
              </span>
              {step.agentOutput.confidence_rationale && (
                <span className="text-xs text-muted-foreground italic">— {step.agentOutput.confidence_rationale}</span>
              )}
            </div>
          )}
          {hasAgentOutput && !isScript && step.agentOutput?.model && (
            <div className="flex items-center gap-1.5">
              <span className="text-muted-foreground">Model:</span>
              <span className="font-mono text-xs">{step.agentOutput.model}</span>
            </div>
          )}
          <div className="flex items-center gap-1">
            <span className="text-muted-foreground">Executed by:</span>
            {isScript ? (
              <span>Automated script</span>
            ) : hasAgentOutput ? (
              <>
                <Bot className="h-3.5 w-3.5" />
                <span>AI Agent</span>
              </>
            ) : (
              <>
                <User className="h-3.5 w-3.5" />
                <span>Human</span>
              </>
            )}
          </div>
          {definition?.type && (
            <div className="flex items-center gap-1.5">
              <span className="text-muted-foreground">Type:</span>
              <span className="capitalize">{definition.type}</span>
            </div>
          )}
        </div>

        {/* Full: audit entries + input/output preview */}
        {detailLevel === 'full' && (
          <div className="space-y-3 pl-9">
            {stepAuditEvents.length > 0 && (
              <div className="space-y-1">
                <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  Audit Trail
                </h4>
                <ul className="space-y-0.5 text-xs">
                  {stepAuditEvents.map((event) => (
                    <li key={event.id} className="flex gap-2 text-muted-foreground">
                      <span className="shrink-0">{format(new Date(event.timestamp), 'HH:mm:ss')}</span>
                      <span className="font-medium text-foreground">{event.action}</span>
                      <span className="truncate">{event.description}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {Object.keys(step.input).length > 0 && (
              <JsonPreview label="Input" value={step.input} />
            )}

            {step.output !== null && Object.keys(step.output).length > 0 && (
              <JsonPreview label="Output" value={step.output} />
            )}
          </div>
        )}
      </div>
    </li>
  );
}

function JsonPreview({ label, value }: { label: string; value: unknown }) {
  const { text, truncated } = truncateJson(value, 10);

  return (
    <div>
      <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">
        {label}
      </h4>
      <pre className="rounded-md bg-muted p-3 text-xs font-mono overflow-auto max-h-[200px] whitespace-pre-wrap break-words">
        {text}
        {truncated && '\n...'}
      </pre>
    </div>
  );
}

function DeliverablesSection({
  finalOutput,
}: {
  finalOutput: ReturnType<typeof findFinalAgentOutput>;
}) {
  const { firebaseUser } = useAuth();

  if (!finalOutput) return null;

  const { stepId, output, result } = finalOutput;
  const git = output.gitMetadata;
  const deliverableFile = output.deliverableFile ?? null;
  const resultOutputFile = typeof result?.output_file === 'string' ? result.output_file : null;
  const effectiveDeliverableFile = deliverableFile ?? resultOutputFile;

  async function handleDownload() {
    if (!effectiveDeliverableFile) return;
    const authToken = firebaseUser ? await firebaseUser.getIdToken() : '';
    const response = await fetch(
      `/api/agent-output-file?path=${encodeURIComponent(effectiveDeliverableFile)}`,
      { headers: authToken ? { Authorization: `Bearer ${authToken}` } : {} },
    );
    if (!response.ok) return;
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = effectiveDeliverableFile.split('/').pop() ?? 'download';
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <section>
      <h2 className="text-lg font-headline font-semibold mb-4">Deliverables</h2>
      <div className="rounded-lg border bg-card p-4 space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <CheckCircle2 className="h-4 w-4 text-green-500" />
            <span>From {formatStepName(stepId)}</span>
          </div>
          {effectiveDeliverableFile && (
            <button
              onClick={handleDownload}
              className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
            >
              <FileText className="h-4 w-4" />
              Download Report
            </button>
          )}
        </div>

        {git && (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-4 text-sm">
              <div className="flex items-center gap-1.5">
                <GitBranch className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="font-mono text-xs">{git.branch}</span>
              </div>
              <a
                href={`${git.repoUrl}/commit/${git.commitSha}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 font-mono text-xs text-primary hover:underline"
              >
                {git.commitSha.slice(0, 7)}
                <ExternalLink className="h-3 w-3" />
              </a>
              <a
                href={`${git.repoUrl}/compare/main...${git.branch}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
              >
                View full diff
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            </div>

            {git.changedFiles.length > 0 && (
              <div>
                <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1.5">
                  Changed Files ({git.changedFiles.length})
                </h4>
                <ul className="space-y-0.5">
                  {git.changedFiles.map((file: string) => (
                    <li key={file}>
                      <a
                        href={`${git.repoUrl}/blob/${git.commitSha}/${file}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-sm font-mono text-primary hover:underline"
                      >
                        <FileText className="h-3 w-3" />
                        {file}
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {!git && result !== null && Object.keys(result).length > 0 && (
          <div>
            <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1.5">
              Output
            </h4>
            <pre className="rounded-md bg-muted p-3 text-xs font-mono overflow-auto max-h-[300px] whitespace-pre-wrap break-words">
              {JSON.stringify(result, null, 2)}
            </pre>
          </div>
        )}
      </div>
    </section>
  );
}

function ReportFooter() {
  return (
    <footer className="text-center text-sm text-muted-foreground pt-4 border-t">
      Generated by Mediforce — {format(new Date(), 'MMMM d, yyyy')}
    </footer>
  );
}
