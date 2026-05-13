'use client';

import * as React from 'react';
import { CheckCircle2, ExternalLink, Gauge, GitBranch, Clock, FileText, DollarSign } from 'lucide-react';
import type { StepExecution, AgentOutputSnapshot } from '@mediforce/platform-core';
import { cn, isBrowsableRepoUrl } from '@/lib/utils';
import { formatDuration, formatStepName, formatCostUsd } from '@/lib/format';

interface RunResultsPanelProps {
  stepExecutions: StepExecution[];
}

const RESULT_KEY_LABELS: Record<string, string> = {
  prurl: 'PR URL',
  prcreated: 'PR Created',
  proposedruleids: 'Proposed Rule IDs',
  branch: 'Branch',
  reason: 'Reason',
};

function formatResultKey(key: string): string {
  const normalized = key.toLowerCase().replace(/_/g, '');
  const explicit = RESULT_KEY_LABELS[normalized];
  if (explicit) return explicit;
  return key
    .replace(/_/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function findPrUrl(result: Record<string, unknown>): { key: string; url: string } | null {
  for (const [key, value] of Object.entries(result)) {
    const normalized = key.toLowerCase().replace(/_/g, '');
    if (normalized === 'prurl' && typeof value === 'string' && value.startsWith('https://')) {
      return { key, url: value };
    }
  }
  return null;
}

function isEmptyResultValue(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string' && value.length === 0) return true;
  if (Array.isArray(value) && value.length === 0) return true;
  return false;
}

function ResultValue({ value }: { value: unknown }) {
  if (typeof value === 'boolean') {
    return <span className="text-sm">{value ? 'Yes' : 'No'}</span>;
  }
  if (typeof value === 'string') {
    if (value.startsWith('https://')) {
      return (
        <a
          href={value}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-sm text-primary hover:underline break-all"
        >
          {value}
          <ExternalLink className="h-3 w-3 shrink-0" />
        </a>
      );
    }
    return <span className="text-sm font-mono break-all">{value}</span>;
  }
  if (typeof value === 'number') {
    return <span className="text-sm font-mono">{value}</span>;
  }
  if (Array.isArray(value)) {
    return (
      <span className="text-sm font-mono break-all">
        {value.map((item) => (typeof item === 'string' ? item : JSON.stringify(item))).join(', ')}
      </span>
    );
  }
  return <span className="text-sm font-mono break-all">{JSON.stringify(value)}</span>;
}

function GithubMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      aria-hidden="true"
      fill="currentColor"
      className={className}
    >
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8z" />
    </svg>
  );
}

function parseGithubPrUrl(url: string): { org: string; repo: string; number: string } | null {
  const match = url.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)(?:[/?#].*)?$/);
  if (!match) return null;
  return { org: match[1], repo: match[2], number: match[3] };
}

function ViewPullRequestButton({ url }: { url: string }) {
  const parsed = parseGithubPrUrl(url);
  if (parsed) {
    return (
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1.5 rounded-md border bg-card px-3 py-1.5 text-sm hover:bg-muted/50 transition-colors"
      >
        <GithubMark className="h-3.5 w-3.5 shrink-0" />
        <span className="text-muted-foreground">{parsed.org}/{parsed.repo}</span>
        <span className="font-semibold">#{parsed.number}</span>
      </a>
    );
  }
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90"
    >
      View Pull Request
      <ExternalLink className="h-3.5 w-3.5" />
    </a>
  );
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
          {output.estimatedCostUsd != null && (
            <div className="flex items-center gap-1.5">
              <DollarSign className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-muted-foreground">Cost:</span>
              <span className="font-medium">{formatCostUsd(output.estimatedCostUsd)}</span>
            </div>
          )}
        </div>

        {/* Git deliverables */}
        {git && (
          <div className="space-y-2">
            {result && (() => {
              const pr = findPrUrl(result);
              return pr ? <ViewPullRequestButton url={pr.url} /> : null;
            })()}
            <div className="flex items-center gap-4 text-sm">
              <div className="flex items-center gap-1.5">
                <GitBranch className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="font-mono text-xs">{git.branch}</span>
              </div>
              {isBrowsableRepoUrl(git.repoUrl) ? (
                <>
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
                </>
              ) : (
                <span className="font-mono text-xs text-muted-foreground">
                  {git.commitSha.slice(0, 7)}
                </span>
              )}
            </div>

            {git.changedFiles.length > 0 && (
              <div>
                <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1.5">
                  Generated Files ({git.changedFiles.length})
                </h4>
                <ul className="space-y-0.5">
                  {git.changedFiles.map((file: string) => (
                    <li key={file}>
                      {isBrowsableRepoUrl(git.repoUrl) ? (
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
                      ) : (
                        <span className="inline-flex items-center gap-1 text-sm font-mono text-muted-foreground">
                          <FileText className="h-3 w-3" />
                          {file}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {/* Result data (non-git output) */}
        {!git && result && Object.keys(result).length > 0 && (() => {
          const pr = findPrUrl(result);
          const remainingEntries = Object.entries(result).filter(([key, value]) => {
            if (pr && key === pr.key) return false;
            return !isEmptyResultValue(value);
          });
          return (
            <div className="space-y-3">
              {pr && <ViewPullRequestButton url={pr.url} />}
              {remainingEntries.length > 0 && (
                <div>
                  <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1.5">
                    Output
                  </h4>
                  <dl className="space-y-1.5">
                    {remainingEntries.map(([key, value]) => (
                      <div key={key} className="flex flex-wrap items-baseline gap-2 text-sm">
                        <dt className="text-muted-foreground">{formatResultKey(key)}:</dt>
                        <dd className="min-w-0 flex-1">
                          <ResultValue value={value} />
                        </dd>
                      </div>
                    ))}
                  </dl>
                </div>
              )}
            </div>
          );
        })()}
      </div>
    </div>
  );
}
