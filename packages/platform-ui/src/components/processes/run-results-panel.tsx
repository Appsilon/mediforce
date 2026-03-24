'use client';

import * as React from 'react';
import { CheckCircle2, ExternalLink, Gauge, GitBranch, Clock, FileText } from 'lucide-react';
import type { StepExecution, AgentOutputSnapshot } from '@mediforce/platform-core';
import { cn } from '@/lib/utils';
import { formatDuration, formatStepName } from '@/lib/format';

interface RunResultsPanelProps {
  stepExecutions: StepExecution[];
}

function findFinalAgentOutput(stepExecutions: StepExecution[]): {
  stepId: string;
  output: AgentOutputSnapshot;
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
  if (!last?.agentOutput) return null;

  return {
    stepId: last.stepId,
    output: last.agentOutput,
    result: last.output,
  };
}

export function RunResultsPanel({ stepExecutions }: RunResultsPanelProps) {
  const finalOutput = React.useMemo(
    () => findFinalAgentOutput(stepExecutions),
    [stepExecutions],
  );

  if (!finalOutput) return null;

  const { stepId, output, result } = finalOutput;
  const confidencePct = output.confidence !== null
    ? Math.round(output.confidence * 100)
    : null;
  const git = output.gitMetadata;

  return (
    <div className="rounded-lg border bg-card">
      {/* Header */}
      <div className="px-4 py-3 border-b bg-green-50/50 dark:bg-green-900/10">
        <div className="flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4 text-green-500" />
          <span className="text-sm font-medium">Results</span>
          <span className="text-xs text-muted-foreground">
            from {formatStepName(stepId)}
          </span>
        </div>
      </div>

      <div className="p-4 space-y-4">
        {/* Metrics row */}
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
          {output.confidence_rationale && (
            <p className="text-xs text-muted-foreground italic">{output.confidence_rationale}</p>
          )}
          {output.model && (
            <div className="flex items-center gap-1.5">
              <span className="text-muted-foreground">Model:</span>
              <span className="font-mono text-xs">{output.model}</span>
            </div>
          )}
          {output.duration_ms !== null && (
            <div className="flex items-center gap-1.5">
              <Clock className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-muted-foreground">Duration:</span>
              <span>{formatDuration(output.duration_ms)}</span>
            </div>
          )}
        </div>

        {/* Git deliverables */}
        {git && (
          <div className="space-y-2">
            <div className="flex items-center gap-4 text-sm">
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
                  Generated Files ({git.changedFiles.length})
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

        {/* Result data (non-git output) */}
        {!git && result && Object.keys(result).length > 0 && (
          <div>
            <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1.5">
              Output
            </h4>
            <pre className="rounded-md bg-muted p-3 text-xs overflow-auto max-h-[300px] whitespace-pre-wrap break-words">
              {JSON.stringify(result, null, 2)}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}
