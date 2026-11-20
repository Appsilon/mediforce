'use client';

import * as React from 'react';
import Link from 'next/link';
import type { AgentConfigSnapshot } from '@mediforce/platform-core';
import { routes } from '@/lib/routes';
import { cn } from '@/lib/utils';
import { useWorkflowsByAgent } from '@/hooks/use-workflows-by-agent';
import { useAgentVersions } from '@/hooks/use-step-evaluation';

const BARE_VERSION_TITLE = /^v\d+$/i;

/** A workflow's stable name over its own `title` when the title is just a
 *  bare version string (e.g. a workflow titled "v1") — rendered next to this
 *  row's agent-version badge, it would otherwise read as two conflicting
 *  version numbers. */
function workflowLabel(workflow: { title: string | undefined; name: string }): string {
  if (workflow.title === undefined || BARE_VERSION_TITLE.test(workflow.title)) return workflow.name;
  return workflow.title;
}

function UsageList({ handle, agentId, currentVersion }: { handle: string; agentId: string; currentVersion: number | null }) {
  const { workflows, loading, error } = useWorkflowsByAgent(agentId);
  const rows = React.useMemo(
    () => (workflows ?? []).flatMap((workflow) => workflow.steps.map((step) => ({ workflow, step }))),
    [workflows],
  );

  if (loading) return <p className="text-xs text-muted-foreground">Loading…</p>;
  if (error !== null) return <p className="text-xs text-destructive">Could not load usage.</p>;
  if (rows.length === 0) return <p className="text-xs text-muted-foreground">No workflow references this agent.</p>;

  return (
    <ul className="divide-y rounded-md border">
      {rows.map(({ workflow, step }) => {
        const stale =
          currentVersion !== null && step.pinnedVersion !== null && step.pinnedVersion !== currentVersion;
        const sameNamespace = workflow.namespace === handle;
        return (
          <li key={`${workflow.namespace}:${workflow.name}:${step.stepId}`} className="flex items-center gap-2 px-3 py-2 text-sm">
            <span className="min-w-0 flex-1 truncate text-xs">
              {sameNamespace ? (
                <Link
                  href={routes.workflowDefinition(workflow.namespace, workflow.name, workflow.version)}
                  className="text-primary hover:underline"
                >
                  {workflowLabel(workflow)}
                </Link>
              ) : (
                <span title={`This workflow lives in @${workflow.namespace}, not in @${handle}`}>
                  {workflowLabel(workflow)}
                </span>
              )}
              <span className="text-muted-foreground"> · step </span>
              <span className="font-mono">{step.stepId}</span>
            </span>
            <span className={cn('w-36 shrink-0 text-right text-xs font-mono', stale ? 'text-amber-600 dark:text-amber-400' : 'text-muted-foreground')}>
              v{step.pinnedVersion ?? 'latest'}{stale && ' · behind'}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function fieldTexts(config: AgentConfigSnapshot): Record<string, string> {
  return {
    Kind: config.kind,
    Runtime: config.runtimeId ?? '(none)',
    Image: config.image ?? '(golden image)',
    Model: config.foundationModel,
    'System prompt': config.systemPrompt,
    'Output schema': config.outputSchema ? JSON.stringify(config.outputSchema, null, 2) : '(none)',
    'MCP servers': JSON.stringify(config.mcpServers, null, 2),
    Skills: config.skills.map((s) => `${s.namespace}/${s.id}`).join(', ') || '(none)',
  };
}

interface ConfigDiffRow {
  label: string;
  before: string;
  after: string;
}

export function diffConfigs(before: AgentConfigSnapshot, after: AgentConfigSnapshot): ConfigDiffRow[] {
  const beforeText = fieldTexts(before);
  const afterText = fieldTexts(after);
  return Object.keys(beforeText)
    .filter((label) => beforeText[label] !== afterText[label])
    .map((label) => ({ label, before: beforeText[label]!, after: afterText[label]! }));
}

function VersionDiff({ before, after }: { before: AgentConfigSnapshot; after: AgentConfigSnapshot }) {
  const rows = diffConfigs(before, after);
  if (rows.length === 0) {
    return <p className="px-3 py-2 text-xs text-muted-foreground">Nothing that shapes this agent's behaviour changed.</p>;
  }
  return (
    <dl className="space-y-2 px-3 py-2 text-xs">
      {rows.map((row) => (
        <div key={row.label}>
          <dt className="font-medium text-muted-foreground">{row.label}</dt>
          <dd className="mt-0.5 grid grid-cols-2 gap-2">
            <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words rounded bg-red-50 p-1.5 text-red-700 dark:bg-red-950/20 dark:text-red-300">
              {row.before}
            </pre>
            <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words rounded bg-emerald-50 p-1.5 text-emerald-700 dark:bg-emerald-950/20 dark:text-emerald-300">
              {row.after}
            </pre>
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function AgentVersionsTab({ handle, agentId }: { handle: string; agentId: string }) {
  const { data, error } = useAgentVersions(agentId);
  const versions = data?.versions ?? null;
  const current = data?.current ?? null;
  const [expandedVersion, setExpandedVersion] = React.useState<number | null>(null);

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium">Used by</h3>
          <span className="w-36 shrink-0 text-right text-xs text-muted-foreground">Agent Version</span>
        </div>
        <UsageList handle={handle} agentId={agentId} currentVersion={current} />
      </div>

      <div className="space-y-2">
        <h3 className="text-sm font-medium">Versions</h3>
        {error !== null && <p className="text-xs text-destructive">Could not load versions.</p>}
        {versions === null && error === null && <p className="text-xs text-muted-foreground">Loading…</p>}
        {versions !== null && versions.length === 0 && (
          <p className="text-xs text-muted-foreground">No versions recorded.</p>
        )}
        {versions !== null && versions.length > 0 && (
          <ul className="divide-y rounded-md border">
            {versions.map((version, i) => {
              const previous = versions[i + 1];
              const isExpanded = expandedVersion === version.version;
              return (
                <li key={version.version}>
                  <div className="flex items-center gap-2 px-3 py-2 text-sm">
                    <span className="w-10 shrink-0 font-mono text-xs">v{version.version}</span>
                    <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{version.config.foundationModel}</span>
                    <span className="w-48 shrink-0 text-xs text-muted-foreground">{version.createdAt}</span>
                    <span className="w-16 shrink-0 text-xs font-medium text-primary">{version.version === current ? 'current' : ''}</span>
                    <span className="w-24 shrink-0 text-right">
                      {previous !== undefined && (
                        <button
                          type="button"
                          onClick={() => setExpandedVersion(isExpanded ? null : version.version)}
                          className="text-xs text-primary hover:underline"
                        >
                          {isExpanded ? 'Hide diff' : `Diff vs v${previous.version}`}
                        </button>
                      )}
                    </span>
                  </div>
                  {isExpanded && previous !== undefined && (
                    <VersionDiff before={previous.config} after={version.config} />
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
