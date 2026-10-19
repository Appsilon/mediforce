'use client';

import * as React from 'react';
import * as Collapsible from '@radix-ui/react-collapsible';
import { ChevronDown, Clock, DollarSign, ExternalLink, FileText, Gauge } from 'lucide-react';
import type { InstanceStatus } from '@mediforce/platform-core';
import type { AgentOutputData } from '@/components/tasks/task-utils';
import { formatCostUsd, formatDuration } from '@/lib/format';
import { cn, isBrowsableRepoUrl } from '@/lib/utils';
import { StepOutputViewer } from './step-output-viewer';

interface AgentOutputDisplayProps {
  agentOutput: AgentOutputData;
  runId: string;
  stepId: string;
  runStatus: InstanceStatus | undefined;
}

/**
 * Full agent output view: metrics header, the step commit's changed files,
 * then the step's one output viewer (`result.json` and its Output Files).
 * Shared between the human-task review wrapper and the workflow step detail
 * page.
 */
export function AgentOutputDisplay({ agentOutput, runId, stepId, runStatus }: AgentOutputDisplayProps) {
  return (
    <div>
      <MetricsHeader agentOutput={agentOutput} />
      {agentOutput.gitMetadata && agentOutput.gitMetadata.changedFiles.length > 0 && (
        <GeneratedFiles git={agentOutput.gitMetadata} />
      )}
      <StepOutputViewer result={agentOutput.result} runId={runId} stepId={stepId} runStatus={runStatus} />
    </div>
  );
}

// ── Metrics header ──────────────────────────────────────────────────────────

function MetricsHeader({ agentOutput }: { agentOutput: AgentOutputData }) {
  const confidencePct = agentOutput.confidence !== null
    ? Math.round(agentOutput.confidence * 100)
    : null;

  const hasAnyMetric =
    confidencePct !== null ||
    agentOutput.model !== null ||
    agentOutput.duration_ms !== null ||
    agentOutput.estimatedCostUsd !== null ||
    agentOutput.tokenUsage !== null;

  if (!hasAnyMetric && !agentOutput.reasoning && !agentOutput.confidence_rationale) {
    return null;
  }

  return (
    <div className="px-4 pt-3 pb-2 space-y-1.5 border-b">
      {hasAnyMetric && (
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          {confidencePct !== null && (
            <span className="inline-flex items-center gap-1">
              <Gauge className="h-3 w-3" />
              <span>Confidence:</span>
              <span className={cn(
                'font-medium',
                confidencePct >= 80 ? 'text-green-600 dark:text-green-400' :
                confidencePct >= 50 ? 'text-amber-600 dark:text-amber-400' :
                'text-red-600 dark:text-red-400',
              )}>{confidencePct}%</span>
            </span>
          )}
          {agentOutput.model && (
            <span className="inline-flex items-center gap-1">
              Model: <span className="font-mono">{agentOutput.model}</span>
            </span>
          )}
          {agentOutput.duration_ms !== null && (
            <span className="inline-flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {formatDuration(agentOutput.duration_ms)}
            </span>
          )}
          {agentOutput.estimatedCostUsd !== null && (
            <span className="inline-flex items-center gap-1">
              <DollarSign className="h-3 w-3" />
              <span className="font-medium">{formatCostUsd(agentOutput.estimatedCostUsd)}</span>
            </span>
          )}
          {agentOutput.tokenUsage && (
            <span className="inline-flex items-center gap-1">
              <span>{agentOutput.tokenUsage.inputTokens.toLocaleString()}</span>
              <span>/</span>
              <span>{agentOutput.tokenUsage.outputTokens.toLocaleString()} tokens</span>
            </span>
          )}
        </div>
      )}
      {agentOutput.reasoning && (
        <p className="text-xs text-muted-foreground italic line-clamp-2">{agentOutput.reasoning}</p>
      )}
      {agentOutput.confidence_rationale && (
        <p className="text-xs text-muted-foreground italic">{agentOutput.confidence_rationale}</p>
      )}
    </div>
  );
}

// ── Generated files (git changedFiles) ──────────────────────────────────────

function GeneratedFiles({
  git,
}: {
  git: NonNullable<AgentOutputData['gitMetadata']>;
}) {
  const browsable = isBrowsableRepoUrl(git.repoUrl);
  const files = git.changedFiles;
  const collapsedByDefault = files.length > 5;
  const [open, setOpen] = React.useState(!collapsedByDefault);

  return (
    <div className="px-4 py-2 border-b">
      <Collapsible.Root open={open} onOpenChange={setOpen}>
        <Collapsible.Trigger className="flex w-full items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground hover:text-foreground transition-colors">
          <ChevronDown className={cn('h-3 w-3 transition-transform', !open && '-rotate-90')} />
          <FileText className="h-3 w-3" />
          Generated Files
          <span className="normal-case font-normal text-muted-foreground/70">({files.length})</span>
          {browsable && (
            <a
              href={`${git.repoUrl}/commit/${git.commitSha}`}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(event) => event.stopPropagation()}
              className="ml-2 inline-flex items-center gap-1 font-mono text-[11px] hover:text-foreground transition-colors"
            >
              {git.commitSha.slice(0, 7)}
              <ExternalLink className="h-3 w-3" />
            </a>
          )}
        </Collapsible.Trigger>
        <Collapsible.Content>
          <ul className="mt-1.5 space-y-0.5">
            {files.map((file) => (
              <li key={file}>
                {browsable ? (
                  <a
                    href={`${git.repoUrl}/blob/${git.commitSha}/${file}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-xs font-mono text-primary hover:underline"
                  >
                    {file}
                    <ExternalLink className="h-3 w-3" />
                  </a>
                ) : (
                  <span className="inline-flex items-center gap-1 text-xs font-mono text-muted-foreground">
                    {file}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </Collapsible.Content>
      </Collapsible.Root>
    </div>
  );
}
