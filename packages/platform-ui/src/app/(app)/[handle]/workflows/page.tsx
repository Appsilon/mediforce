'use client';

import { useMemo } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { where } from 'firebase/firestore';
import { ArrowLeft, GitBranch } from 'lucide-react';
import { useCollection } from '@/hooks/use-collection';
import type { WorkflowDefinition } from '@mediforce/platform-core';

type WorkflowDefinitionWithId = WorkflowDefinition & { id: string };

type LatestWorkflow = {
  name: string;
  version: number;
  title: string | undefined;
  description: string | undefined;
  archived: boolean;
};

export default function NamespaceWorkflowsPage() {
  const params = useParams();
  const rawHandle = params.handle;
  const handle = Array.isArray(rawHandle) ? rawHandle[0] : rawHandle;

  const constraints = useMemo(
    () => (handle !== undefined && handle !== '' ? [where('namespace', '==', handle)] : []),
    [handle],
  );

  const { data: workflows, loading } = useCollection<WorkflowDefinitionWithId>(
    'workflowDefinitions',
    constraints,
  );

  const latestWorkflows = useMemo((): LatestWorkflow[] => {
    const byName = new Map<string, WorkflowDefinitionWithId>();
    for (const workflow of workflows) {
      const existing = byName.get(workflow.name);
      if (existing === undefined || workflow.version > existing.version) {
        byName.set(workflow.name, workflow);
      }
    }
    return [...byName.values()]
      .sort((workflowA, workflowB) => workflowA.name.localeCompare(workflowB.name))
      .map((workflow) => ({
        name: workflow.name,
        version: workflow.version,
        title: workflow.title,
        description: workflow.description,
        archived: workflow.archived === true,
      }));
  }, [workflows]);

  return (
    <div className="min-h-screen bg-background px-4 py-12">
      <div className="mx-auto max-w-2xl">
        <div className="mb-8">
          <Link
            href={`/${handle}`}
            className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors mb-4"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            @{handle}
          </Link>
          <h1 className="text-xl font-semibold">Workflows</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Workflows published in this namespace.
          </p>
        </div>

        {loading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((index) => (
              <div
                key={index}
                className="rounded-lg border bg-card px-4 py-4 animate-pulse flex gap-3"
              >
                <div className="h-7 w-7 rounded-md bg-muted shrink-0" />
                <div className="space-y-2 flex-1">
                  <div className="h-4 w-36 rounded bg-muted" />
                  <div className="h-3 w-52 rounded bg-muted" />
                </div>
              </div>
            ))}
          </div>
        ) : latestWorkflows.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 py-20 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
              <GitBranch className="h-6 w-6 text-muted-foreground" />
            </div>
            <p className="text-sm text-muted-foreground">No workflows in this namespace yet.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {latestWorkflows.map((workflow) => (
              <Link
                key={workflow.name}
                href={`/workflows/${encodeURIComponent(workflow.name)}`}
                className="flex items-start gap-3 rounded-lg border bg-card px-4 py-4 hover:border-primary/40 hover:shadow-sm hover:bg-muted/20 transition-all group"
              >
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary/10 mt-0.5">
                  <GitBranch className="h-3.5 w-3.5 text-primary" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-sm group-hover:text-primary transition-colors">
                      {workflow.name}
                    </span>
                    <span className="text-xs text-muted-foreground font-mono">
                      v{workflow.version}
                    </span>
                    {workflow.archived && (
                      <span className="rounded-full bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
                        Archived
                      </span>
                    )}
                  </div>
                  {workflow.description !== undefined && workflow.description !== '' && (
                    <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                      {workflow.description}
                    </p>
                  )}
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
