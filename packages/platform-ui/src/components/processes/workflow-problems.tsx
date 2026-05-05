'use client';

import * as React from 'react';
import { AlertTriangle, Copy, Check, ChevronDown, ChevronUp } from 'lucide-react';
import type { WorkflowDefinition } from '@mediforce/platform-core';
import { useDockerImages } from '@/hooks/use-docker-images';
import { useAuth } from '@/contexts/auth-context';
import { getWorkflowSecretKeys } from '@/app/actions/workflow-secrets';
import { runPreflightChecks, type PreflightWarning } from '@/lib/preflight-checks';
import { cn } from '@/lib/utils';

const MAX_VISIBLE = 10;

interface WorkflowWarning extends PreflightWarning {
  workflowName: string;
  workflowTitle?: string;
}

interface WorkflowProblemsProps {
  handle: string;
  latestDocs: Map<string, WorkflowDefinition & { id: string }>;
  loading: boolean;
}

export function WorkflowProblems({ handle, latestDocs, loading }: WorkflowProblemsProps) {
  const { firebaseUser } = useAuth();
  const { images: dockerImages, isAvailable: dockerAvailable, isLoading: dockerLoading } = useDockerImages();
  const [secretsByWorkflow, setSecretsByWorkflow] = React.useState<Map<string, string[]>>(new Map());
  const [secretsLoading, setSecretsLoading] = React.useState(true);
  const [showAll, setShowAll] = React.useState(false);
  const [copied, setCopied] = React.useState(false);

  const namespaceDocs = React.useMemo(() => {
    const result: Array<WorkflowDefinition & { id: string }> = [];
    for (const doc of latestDocs.values()) {
      if (doc.namespace === handle && doc.archived !== true) {
        result.push(doc);
      }
    }
    return result;
  }, [latestDocs, handle]);

  React.useEffect(() => {
    if (!handle || !firebaseUser || namespaceDocs.length === 0) {
      setSecretsLoading(false);
      return;
    }
    let cancelled = false;
    setSecretsLoading(true);

    Promise.all(
      namespaceDocs.map(async (doc): Promise<[string, string[]]> => {
        try {
          const keys = await getWorkflowSecretKeys(handle, doc.name, firebaseUser.uid);
          return [doc.name, keys];
        } catch {
          return [doc.name, []];
        }
      }),
    ).then((results) => {
      if (cancelled) return;
      const map = new Map<string, string[]>();
      for (const [name, keys] of results) {
        map.set(name, keys);
      }
      setSecretsByWorkflow(map);
      setSecretsLoading(false);
    });

    return () => { cancelled = true; };
  }, [handle, firebaseUser, namespaceDocs]);

  const warnings = React.useMemo((): WorkflowWarning[] => {
    const all: WorkflowWarning[] = [];
    for (const doc of namespaceDocs) {
      const secretKeys = secretsByWorkflow.get(doc.name);
      const checks = runPreflightChecks(doc, {
        dockerImages,
        dockerAvailable,
        secretKeys,
      });
      for (const warning of checks) {
        all.push({ ...warning, workflowName: doc.name, workflowTitle: doc.title });
      }
    }
    return all;
  }, [namespaceDocs, dockerImages, dockerAvailable, secretsByWorkflow]);

  const isLoading = loading || dockerLoading || secretsLoading;

  if (isLoading || warnings.length === 0) return null;

  const visible = showAll ? warnings : warnings.slice(0, MAX_VISIBLE);
  const hasMore = warnings.length > MAX_VISIBLE;

  function formatForCopy(): string {
    const lines: string[] = [`Workflow problems for @${handle} (${warnings.length} total):`, ''];
    for (const warning of warnings) {
      const label = warning.workflowTitle
        ? `${warning.workflowTitle} (${warning.workflowName})`
        : warning.workflowName;
      lines.push(`- [${label}] ${warning.message}`);
      lines.push(`  Steps: ${warning.stepNames.join(', ')}`);
      lines.push(`  Hint: ${warning.hint}`);
    }
    return lines.join('\n');
  }

  async function handleCopy() {
    await navigator.clipboard.writeText(formatForCopy());
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50/50 dark:border-amber-900/50 dark:bg-amber-950/20 p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400" />
          <h3 className="text-sm font-semibold text-amber-900 dark:text-amber-200">
            {warnings.length} {warnings.length === 1 ? 'problem' : 'problems'} across workflows
          </h3>
        </div>
        <button
          type="button"
          onClick={handleCopy}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
            copied
              ? 'text-green-700 dark:text-green-400'
              : 'text-amber-700 hover:bg-amber-100 dark:text-amber-300 dark:hover:bg-amber-900/30',
          )}
        >
          {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
          {copied ? 'Copied' : 'Copy all'}
        </button>
      </div>

      <ul className="space-y-1.5">
        {visible.map((warning, idx) => {
          const showName = warning.workflowTitle && warning.workflowTitle !== warning.workflowName;
          return (
            <li key={`${warning.workflowName}-${warning.category}-${warning.resource}-${idx}`} className="text-sm">
              <span className="font-medium text-foreground">
                {warning.workflowTitle || warning.workflowName}
              </span>
              {showName && (
                <span className="text-xs text-muted-foreground ml-1 font-mono">
                  ({warning.workflowName})
                </span>
              )}
              <span className="text-muted-foreground">
                {' — '}{warning.message}
              </span>
            </li>
          );
        })}
      </ul>

      {hasMore && (
        <button
          type="button"
          onClick={() => setShowAll((prev) => !prev)}
          className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-amber-700 hover:text-amber-900 dark:text-amber-400 dark:hover:text-amber-200 transition-colors"
        >
          {showAll ? (
            <>
              <ChevronUp className="h-3.5 w-3.5" />
              Show less
            </>
          ) : (
            <>
              <ChevronDown className="h-3.5 w-3.5" />
              Show all {warnings.length} problems
            </>
          )}
        </button>
      )}
    </div>
  );
}
