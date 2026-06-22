'use client';

import * as React from 'react';
import Link from 'next/link';
import { AlertTriangle, Copy, Check, ChevronDown, ChevronUp } from 'lucide-react';
import type { WorkflowDefinition } from '@mediforce/platform-core';
import { useDockerImages } from '@/hooks/use-docker-images';
import { useNamespaceRole } from '@/hooks/use-namespace-role';
import { useWorkflowSecretKeysContext } from '@/hooks/use-workflow-secret-keys';
import { runPreflightChecks, type PreflightWarning } from '@/lib/preflight-checks';
import { cn } from '@/lib/utils';

const MAX_VISIBLE = 10;

interface WorkflowWarning extends PreflightWarning {
  workflowName: string;
  workflowTitle?: string;
}

interface WorkflowProblemsProps {
  handle: string;
  latestDocs: Map<string, WorkflowDefinition>;
  loading: boolean;
}

export function WorkflowProblems({ handle, latestDocs, loading }: WorkflowProblemsProps) {
  const { images: dockerImages, isAvailable: dockerAvailable, isLoading: dockerLoading } = useDockerImages();
  const { canAdmin } = useNamespaceRole(handle);
  const secretKeysCtx = useWorkflowSecretKeysContext();
  const [showAll, setShowAll] = React.useState(false);
  const [copied, setCopied] = React.useState(false);

  const namespaceDocs = React.useMemo(() => {
    const result: WorkflowDefinition[] = [];
    for (const doc of latestDocs.values()) {
      if (doc.namespace === handle && doc.archived !== true) {
        result.push(doc);
      }
    }
    return result;
  }, [latestDocs, handle]);

  const namespaceSecretKeys = secretKeysCtx?.namespaceKeys;

  const warnings = React.useMemo((): WorkflowWarning[] => {
    const all: WorkflowWarning[] = [];
    for (const doc of namespaceDocs) {
      const secretKeys = secretKeysCtx?.getKeys(doc.name);
      const checks = runPreflightChecks(doc, {
        dockerImages,
        dockerAvailable,
        secretKeys,
        namespaceSecretKeys,
        handle,
        workflowName: doc.name,
      });
      for (const warning of checks) {
        all.push({ ...warning, workflowName: doc.name, workflowTitle: doc.title });
      }
    }
    return all;
  }, [namespaceDocs, dockerImages, dockerAvailable, secretKeysCtx, namespaceSecretKeys]);

  const isLoading = loading || dockerLoading || (secretKeysCtx?.loading ?? false);

  if (isLoading || warnings.length === 0) return null;

  const visible = showAll ? warnings : warnings.slice(0, MAX_VISIBLE);
  const hasMore = warnings.length > MAX_VISIBLE;

  function formatForCopy(): string {
    const lines: string[] = [`Workflow problems for @${handle} (${warnings.length} total):`, ''];
    for (const warning of warnings) {
      const label = warning.workflowTitle ? `${warning.workflowTitle} (${warning.workflowName})` : warning.workflowName;
      lines.push(`- [${label}] ${warning.message}`);
      lines.push(`  Steps: ${warning.stepNames.join(', ')}`);
      lines.push(`  Actions: ${warning.actions.map((a) => `${a.label}: ${a.href}`).join(', ')}`);
    }
    return lines.join('\n');
  }

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(formatForCopy());
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      console.warn('[WorkflowProblems] Clipboard write failed');
    }
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
        {visible.map((warning) => {
          const showName = warning.workflowTitle && warning.workflowTitle !== warning.workflowName;
          return (
            <li key={`${warning.workflowName}-${warning.category}-${warning.resource}`} className="text-sm">
              <span className="font-medium text-foreground">{warning.workflowTitle || warning.workflowName}</span>
              {showName && (
                <span className="text-xs text-muted-foreground ml-1 font-mono">({warning.workflowName})</span>
              )}
              <span className="text-muted-foreground">
                {' — '}
                {warning.message}
              </span>
              {canAdmin && warning.category === 'missing-image' && (
                <Link
                  href={`/${handle}/admin/infrastructure`}
                  className="ml-1.5 text-xs text-amber-700 underline hover:text-amber-900 dark:text-amber-400 dark:hover:text-amber-200"
                >
                  View images
                </Link>
              )}
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
