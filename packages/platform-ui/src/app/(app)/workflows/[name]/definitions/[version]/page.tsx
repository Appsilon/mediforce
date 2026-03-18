'use client';

import * as React from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowLeft, Edit, Play } from 'lucide-react';
import { useWorkflowDefinitions } from '@/hooks/use-workflow-definitions';
import { WorkflowDiagram } from '@/components/workflows/workflow-diagram';
import { cn } from '@/lib/utils';
import type { WorkflowStep } from '@mediforce/platform-core';

export default function WorkflowDefinitionVersionPage() {
  const { name, version } = useParams<{ name: string; version: string }>();
  const decodedName = decodeURIComponent(name);
  const versionNumber = parseInt(version, 10);

  const { definitions, loading } = useWorkflowDefinitions(decodedName);
  const definition = definitions.find((def) => def.version === versionNumber) ?? null;

  if (loading) {
    return (
      <div className="p-6 space-y-4 animate-pulse">
        <div className="h-4 w-20 rounded bg-muted" />
        <div className="h-7 w-48 rounded bg-muted" />
        <div className="h-48 rounded bg-muted" />
      </div>
    );
  }

  if (!loading && definition === null) {
    return (
      <div className="p-6 text-center text-sm text-muted-foreground">
        Definition v{version} for &ldquo;{decodedName}&rdquo; not found.{' '}
        <Link
          href={`/workflows/${name}`}
          className="underline"
        >
          Back to workflow
        </Link>
      </div>
    );
  }

  if (definition === null) return null;

  return (
    <div className="flex flex-1 flex-col gap-0">
      {/* Header */}
      <div className="border-b px-6 py-4">
        <Link
          href={`/workflows/${name}`}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors mb-3"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          {decodedName}
        </Link>

        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-headline font-semibold">{decodedName}</h1>
              <span className="font-mono bg-muted px-2 py-0.5 text-sm rounded">
                v{definition.version}
              </span>
              {definition.archived === true && (
                <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                  Archived
                </span>
              )}
            </div>
            {definition.description && (
              <p className="text-sm text-muted-foreground mt-0.5">{definition.description}</p>
            )}
            {definition.createdAt && (
              <p className="text-xs text-muted-foreground mt-1">
                Created {new Date(definition.createdAt).toLocaleDateString()}
              </p>
            )}
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <Link
              href={`/workflows/${name}/edit`}
              className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-muted transition-colors whitespace-nowrap"
            >
              <Edit className="h-3.5 w-3.5" />
              Edit
            </Link>
            <button
              className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors whitespace-nowrap"
            >
              <Play className="h-3.5 w-3.5" />
              Start Run
            </button>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 p-6 space-y-8">
        {/* Diagram */}
        <section>
          <WorkflowDiagram definition={definition} />
        </section>

        {/* Steps */}
        <section>
          <h2 className="text-sm font-semibold mb-3">
            Steps ({definition.steps.length})
          </h2>
          <div className="space-y-3">
            {definition.steps.map((step) => (
              <StepCard key={step.id} step={step} />
            ))}
          </div>
        </section>

        {/* Transitions */}
        {definition.transitions.length > 0 && (
          <section>
            <h2 className="text-sm font-semibold mb-3">
              Transitions ({definition.transitions.length})
            </h2>
            <div className="rounded-lg border divide-y">
              {definition.transitions.map((transition, index) => (
                <div
                  key={index}
                  className="flex items-center gap-3 px-4 py-2.5 text-sm"
                >
                  <span className="font-mono text-muted-foreground">{transition.from}</span>
                  <span className="text-muted-foreground">→</span>
                  <span className="font-mono">{transition.to}</span>
                  {transition.when && (
                    <span className="ml-auto rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                      when: {transition.when}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Triggers */}
        {definition.triggers.length > 0 && (
          <section>
            <h2 className="text-sm font-semibold mb-3">
              Triggers ({definition.triggers.length})
            </h2>
            <div className="flex flex-wrap gap-2">
              {definition.triggers.map((trigger) => (
                <div
                  key={trigger.name}
                  className="rounded-lg border bg-card px-4 py-2.5 text-sm"
                >
                  <span className="font-medium">{trigger.name}</span>
                  <span className="ml-2 text-muted-foreground capitalize">{trigger.type}</span>
                  {trigger.type === 'cron' && 'schedule' in trigger && trigger.schedule && (
                    <span className="ml-2 font-mono text-xs bg-muted px-1.5 py-0.5 rounded">
                      {trigger.schedule}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

function StepCard({ step }: { step: WorkflowStep }) {
  const stepTypeColors: Record<string, string> = {
    creation: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
    review: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400',
    decision: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400',
    terminal: 'bg-muted text-muted-foreground',
  };

  const executorColors: Record<string, string> = {
    human: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
    agent: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400',
    script: 'bg-gray-100 text-gray-700 dark:bg-gray-900/30 dark:text-gray-400',
  };

  return (
    <div className="rounded-lg border bg-card px-4 py-3 space-y-1.5">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="font-medium text-sm">{step.name}</span>
        <span className="font-mono text-xs text-muted-foreground">{step.id}</span>

        <span
          className={cn(
            'rounded-full px-2 py-0.5 text-xs font-medium capitalize',
            stepTypeColors[step.type] ?? 'bg-muted text-muted-foreground',
          )}
        >
          {step.type}
        </span>

        <span
          className={cn(
            'rounded-full px-2 py-0.5 text-xs font-medium capitalize',
            executorColors[step.executor] ?? 'bg-muted text-muted-foreground',
          )}
        >
          {step.executor}
        </span>

        {step.autonomyLevel !== undefined && (
          <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
            {step.autonomyLevel}
          </span>
        )}

        {step.plugin !== undefined && (
          <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-mono text-muted-foreground">
            {step.plugin}
          </span>
        )}
      </div>

      {step.description && (
        <p className="text-xs text-muted-foreground">{step.description}</p>
      )}
    </div>
  );
}
