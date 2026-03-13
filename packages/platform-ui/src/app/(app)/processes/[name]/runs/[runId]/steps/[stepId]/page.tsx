'use client';

import { useParams } from 'next/navigation';
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { format } from 'date-fns';
import { ArrowLeft, CheckCircle2, Clock, XCircle, Circle, Pause, Bot, User, ExternalLink, FileText, GitBranch, Gauge, ChevronDown, ChevronRight, MessageSquare } from 'lucide-react';
import type { StepExecution, Step, AgentEvent } from '@mediforce/platform-core';
import { useProcessInstance, useSubcollection } from '@/hooks/use-process-instances';
import { useProcessDefinitionVersions } from '@/hooks/use-process-definitions';
import { cn } from '@/lib/utils';

function formatStepName(stepId: string): string {
  return stepId
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return remainingSeconds > 0 ? `${minutes}m ${remainingSeconds}s` : `${minutes}m`;
}

function StatusIcon({ status }: { status: string }) {
  switch (status) {
    case 'completed':
      return <CheckCircle2 className="h-5 w-5 text-green-500" />;
    case 'running':
      return <Clock className="h-5 w-5 text-blue-500 animate-spin" />;
    case 'failed':
      return <XCircle className="h-5 w-5 text-red-500" />;
    case 'waiting':
      return <Pause className="h-5 w-5 text-amber-500" />;
    default:
      return <Circle className="h-5 w-5 text-muted-foreground" />;
  }
}

export default function StepDetailPage() {
  const { name, runId, stepId } = useParams<{ name: string; runId: string; stepId: string }>();

  const decodedName = name ? decodeURIComponent(name) : '';
  const decodedStepId = stepId ? decodeURIComponent(stepId) : '';

  const { data: instance, loading: instanceLoading } = useProcessInstance(runId ?? null);
  const { data: stepExecutions, loading: stepsLoading } = useSubcollection<StepExecution>(
    runId ? `processInstances/${runId}` : '',
    'stepExecutions',
  );
  const { data: agentEvents, loading: eventsLoading } = useSubcollection<AgentEvent>(
    runId ? `processInstances/${runId}` : '',
    'agentEvents',
  );

  const { versions } = useProcessDefinitionVersions(decodedName);

  const definition = useMemo(() => {
    if (!instance || versions.length === 0) return null;
    return versions.find((v) => v.version === instance.definitionVersion) ?? null;
  }, [instance, versions]);

  const definitionStep = useMemo((): Step | null => {
    return definition?.steps.find((s) => s.id === decodedStepId) ?? null;
  }, [definition, decodedStepId]);

  // Find previous step name for the "From:" label
  const previousStepName = useMemo(() => {
    const transitions = definition?.transitions ?? [];
    const incoming = transitions.find((t) => t.to === decodedStepId);
    if (!incoming) return null;
    const prevStep = definition?.steps.find((s) => s.id === incoming.from);
    return prevStep?.name ?? formatStepName(incoming.from);
  }, [definition, decodedStepId]);

  // Get the latest execution for this step
  const execution = useMemo((): StepExecution | null => {
    const execs = stepExecutions
      .filter((e) => e.stepId === decodedStepId)
      .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());
    return execs[0] ?? null;
  }, [stepExecutions, decodedStepId]);

  // Agent prompt event for this step
  const promptEvent = useMemo(() => {
    return agentEvents
      .filter((e) => e.stepId === decodedStepId)
      .sort((a, b) => a.sequence - b.sequence)
      .find((e) => e.type === 'prompt') ?? null;
  }, [agentEvents, decodedStepId]);

  const loading = instanceLoading || stepsLoading || eventsLoading;

  if (loading) {
    return (
      <div className="p-6 space-y-4">
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

  const backHref = `/processes/${encodeURIComponent(decodedName)}/runs/${runId}`;
  const stepName = definitionStep?.name ?? formatStepName(decodedStepId);
  const isAgent = execution?.agentOutput !== undefined;

  return (
    <div className="p-6 space-y-6 max-w-6xl">
      {/* Back */}
      <Link href={backHref} className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors">
        <ArrowLeft className="h-4 w-4" />
        {decodedName}
      </Link>

      {/* Header */}
      <div className="space-y-2">
        <div className="flex items-center gap-3">
          {execution && <StatusIcon status={execution.status} />}
          <h1 className="text-2xl font-headline font-semibold">{stepName}</h1>
          {isAgent && (
            <span className="inline-flex items-center gap-1 rounded-full bg-violet-100 dark:bg-violet-900/30 px-2 py-0.5 text-xs text-violet-700 dark:text-violet-300">
              <Bot className="h-3 w-3" /> Agent
            </span>
          )}
        </div>
        <div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
          <span>Step ID: <span className="font-mono text-foreground text-xs">{decodedStepId}</span></span>
          {execution && (
            <>
              <span>Executed by: <span className="inline-flex items-center gap-1 text-foreground">
                {execution.executedBy === 'auto-runner' ? <Bot className="h-3 w-3" /> : <User className="h-3 w-3" />}
                {execution.executedBy}
              </span></span>
              <span>Started: <span className="text-foreground">{format(new Date(execution.startedAt), 'MMM d, HH:mm:ss')}</span></span>
              {execution.completedAt && (
                <span>Completed: <span className="text-foreground">{format(new Date(execution.completedAt), 'MMM d, HH:mm:ss')}</span></span>
              )}
            </>
          )}
        </div>
        {execution?.error && (
          <div className="rounded-md bg-red-50 border border-red-200 dark:bg-red-900/20 dark:border-red-800 px-3 py-2 text-sm text-red-800 dark:text-red-300">
            Error: {execution.error}
          </div>
        )}
      </div>

      {/* Two-column: Input | Output */}
      {execution ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <InputColumn
            execution={execution}
            previousStepName={previousStepName}
            promptEvent={promptEvent}
          />
          <OutputColumn execution={execution} />
        </div>
      ) : (
        <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          This step has not been executed yet.
        </div>
      )}
    </div>
  );
}

// ── Input Column ────────────────────────────────────────────────────────────

function InputColumn({ execution, previousStepName, promptEvent }: {
  execution: StepExecution;
  previousStepName: string | null;
  promptEvent: AgentEvent | null;
}) {
  const input = execution.input;
  const hasInput = Object.keys(input).length > 0;
  const isAgent = execution.agentOutput !== undefined;

  return (
    <div className="space-y-3">
      <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">Input</h2>
      <div className="rounded-lg border bg-card divide-y">
        {hasInput && (
          <div className="p-4 space-y-2">
            {previousStepName && (
              <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                From: {previousStepName}
              </h3>
            )}
            <div className="divide-y">
              {Object.entries(input).map(([key, value]) => (
                <DataEntry key={key} label={key} value={value} />
              ))}
            </div>
          </div>
        )}

        {isAgent && promptEvent && (
          <CollapsiblePrompt prompt={promptEvent.payload} />
        )}

        {!hasInput && !promptEvent && (
          <div className="p-6 text-center text-sm text-muted-foreground">
            {previousStepName === null ? 'Entry point — no input data' : 'No input data'}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Collapsible Prompt ──────────────────────────────────────────────────────

function CollapsiblePrompt({ prompt }: { prompt: unknown }) {
  const [expanded, setExpanded] = useState(false);
  const promptText = typeof prompt === 'string' ? prompt : JSON.stringify(prompt, null, 2);
  const isLong = promptText.length > 300;

  return (
    <div className="p-4 space-y-2">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground hover:text-foreground transition-colors"
      >
        {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        <MessageSquare className="h-3.5 w-3.5" />
        Agent Prompt
        {isLong && !expanded && (
          <span className="normal-case font-normal">({Math.round(promptText.length / 1000)}k chars)</span>
        )}
      </button>
      {expanded && (
        <pre className="rounded-md bg-muted p-3 text-xs overflow-auto max-h-[500px] whitespace-pre-wrap break-words">
          {promptText}
        </pre>
      )}
    </div>
  );
}

// ── Output Column ───────────────────────────────────────────────────────────

function OutputColumn({ execution }: { execution: StepExecution }) {
  const agentOutput = execution.agentOutput;
  const hasAgent = agentOutput !== undefined;
  const output = execution.output;
  const hasOutput = output !== null && Object.keys(output).length > 0;

  return (
    <div className="space-y-3">
      <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">Output</h2>
      <div className="rounded-lg border bg-card">
        {!hasOutput && !hasAgent ? (
          <div className="p-6 text-center text-sm text-muted-foreground">
            No output data
          </div>
        ) : (
          <div className="divide-y">
            {hasAgent && agentOutput && (
              <AgentMetadataSection agentOutput={agentOutput} />
            )}

            {hasAgent && agentOutput?.gitMetadata && (
              <GitSection git={agentOutput.gitMetadata} />
            )}

            {hasOutput && Object.entries(output).map(([key, value]) => (
              <DataEntry key={key} label={key} value={value} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Agent Metadata ──────────────────────────────────────────────────────────

function AgentMetadataSection({ agentOutput }: { agentOutput: NonNullable<StepExecution['agentOutput']> }) {
  const confidencePct = agentOutput.confidence !== null
    ? Math.round(agentOutput.confidence * 100)
    : null;

  return (
    <div className="p-4 space-y-2">
      <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
        <Bot className="h-3.5 w-3.5" />
        Agent
      </h3>
      <div className="flex flex-wrap gap-4 text-sm">
        {confidencePct !== null && (
          <div className="flex items-center gap-1.5">
            <Gauge className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-muted-foreground">Confidence:</span>
            <span className={cn(
              'font-medium',
              confidencePct >= 80 ? 'text-green-600 dark:text-green-400' :
              confidencePct >= 50 ? 'text-amber-600 dark:text-amber-400' :
              'text-red-600 dark:text-red-400'
            )}>{confidencePct}%</span>
          </div>
        )}
        {agentOutput.model && (
          <div className="flex items-center gap-1.5">
            <span className="text-muted-foreground">Model:</span>
            <span className="font-mono text-xs">{agentOutput.model}</span>
          </div>
        )}
        {agentOutput.duration_ms !== null && (
          <div className="flex items-center gap-1.5">
            <Clock className="h-3.5 w-3.5 text-muted-foreground" />
            <span>{formatDuration(agentOutput.duration_ms)}</span>
          </div>
        )}
      </div>
      {agentOutput.reasoning && (
        <p className="text-sm text-muted-foreground">{agentOutput.reasoning}</p>
      )}
    </div>
  );
}

// ── Git Section ─────────────────────────────────────────────────────────────

function GitSection({ git }: { git: { commitSha: string; branch: string; changedFiles: string[]; repoUrl: string } }) {
  return (
    <div className="p-4 space-y-2">
      <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
        <GitBranch className="h-3.5 w-3.5" />
        Git
      </h3>
      <div className="flex items-center gap-4 text-sm">
        <span className="font-mono text-xs">{git.branch}</span>
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
          View diff
          <ExternalLink className="h-3.5 w-3.5" />
        </a>
      </div>
      {git.changedFiles.length > 0 && (
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
      )}
    </div>
  );
}

// ── Generic Data Entry ──────────────────────────────────────────────────────

function DataEntry({ label, value }: { label: string; value: unknown }) {
  const displayLabel = label
    .replace(/[-_]/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\b\w/g, (c) => c.toUpperCase());

  return (
    <div className="p-4">
      <dt className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1.5">
        {displayLabel}
      </dt>
      <dd className="text-sm">
        <DataValue value={value} />
      </dd>
    </div>
  );
}

function DataValue({ value }: { value: unknown }) {
  if (value === null || value === undefined) {
    return <span className="text-muted-foreground italic">-</span>;
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if ((trimmed.startsWith('[') || trimmed.startsWith('{')) && trimmed.length > 2) {
      try {
        const parsed: unknown = JSON.parse(trimmed);
        if (typeof parsed === 'object' && parsed !== null) {
          return <DataValue value={parsed} />;
        }
      } catch {
        // not JSON
      }
    }
    if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
      return (
        <a href={trimmed} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline break-all">
          {trimmed}
        </a>
      );
    }
    return <span className="whitespace-pre-wrap break-words">{value}</span>;
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return <span className="font-mono text-xs">{String(value)}</span>;
  }

  if (Array.isArray(value) && value.length > 0 && isFileArray(value)) {
    return <FileList files={value as FileItem[]} />;
  }

  if (Array.isArray(value)) {
    if (value.length === 0) return <span className="text-muted-foreground italic">None</span>;
    if (value.every((item) => typeof item === 'string')) {
      return (
        <div className="flex flex-wrap gap-1.5">
          {value.map((item, index) => (
            <span key={index} className="inline-flex rounded-full bg-muted px-2.5 py-0.5 text-xs">
              {item as string}
            </span>
          ))}
        </div>
      );
    }
    return (
      <pre className="rounded-md bg-muted p-3 text-xs overflow-auto max-h-[400px] whitespace-pre-wrap break-words">
        {JSON.stringify(value, null, 2)}
      </pre>
    );
  }

  if (typeof value === 'object') {
    return (
      <pre className="rounded-md bg-muted p-3 text-xs overflow-auto max-h-[400px] whitespace-pre-wrap break-words">
        {JSON.stringify(value, null, 2)}
      </pre>
    );
  }

  return <span>{String(value)}</span>;
}

// ── File helpers ────────────────────────────────────────────────────────────

interface FileItem {
  name: string;
  size: number;
  type: string;
  downloadUrl?: string | null;
  storagePath?: string | null;
}

function isFileArray(arr: unknown[]): boolean {
  return arr.every(
    (item) =>
      typeof item === 'object' &&
      item !== null &&
      'name' in item &&
      'size' in item &&
      'type' in item,
  );
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const exp = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const size = bytes / Math.pow(1024, exp);
  return `${size.toFixed(exp > 0 ? 1 : 0)} ${units[exp]}`;
}

function FileList({ files }: { files: FileItem[] }) {
  return (
    <div className="space-y-1">
      <span className="text-xs text-muted-foreground">{files.length} file{files.length !== 1 ? 's' : ''}</span>
      <ul className="space-y-0.5">
        {files.map((file) => (
          <li key={file.name} className="flex items-center gap-2 text-sm">
            <FileText className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            {file.downloadUrl ? (
              <a href={file.downloadUrl} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline truncate">
                {file.name}
              </a>
            ) : (
              <span className="truncate">{file.name}</span>
            )}
            <span className="text-xs text-muted-foreground shrink-0">{formatBytes(file.size)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
