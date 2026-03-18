'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowLeft, Edit, Play, X, User, Bot, Terminal } from 'lucide-react';
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
  const [selectedStepId, setSelectedStepId] = useState<string | null>(null);

  const selectedStep = definition?.steps.find((s) => s.id === selectedStepId) ?? null;

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
        <Link href={`/workflows/${name}`} className="underline">Back to workflow</Link>
      </div>
    );
  }

  if (definition === null) return null;

  return (
    <div className="flex flex-1 flex-col relative">
      {/* Floating header */}
      <div className="absolute top-0 left-0 right-0 z-10 pointer-events-none">
        <div className="px-4 pt-3 pb-2 pointer-events-auto inline-flex flex-col gap-2">
          <Link
            href={`/workflows/${name}`}
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors w-fit"
          >
            <ArrowLeft className="h-3 w-3" />
            {decodedName}
          </Link>

          <div className="flex items-center gap-2">
            <h1 className="text-base font-headline font-semibold">{decodedName}</h1>
            <span className="font-mono bg-background/80 backdrop-blur border px-1.5 py-0.5 text-xs rounded">
              v{definition.version}
            </span>
            {definition.archived === true && (
              <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                Archived
              </span>
            )}
          </div>
        </div>

        {/* Action buttons — top right */}
        <div className="absolute top-3 right-4 flex items-center gap-2 pointer-events-auto">
          <Link
            href={`/workflows/${name}/edit`}
            className="inline-flex items-center gap-1.5 rounded-md border bg-background/80 backdrop-blur px-3 py-1.5 text-sm font-medium hover:bg-muted transition-colors whitespace-nowrap"
          >
            <Edit className="h-3.5 w-3.5" />
            Edit
          </Link>
          <button className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors whitespace-nowrap">
            <Play className="h-3.5 w-3.5" />
            Start Run
          </button>
        </div>
      </div>

      {/* Diagram — fills entire area */}
      <div className="flex-1" style={{ minHeight: 'calc(100vh - 120px)' }}>
        <WorkflowDiagram
          definition={definition}
          className="h-full rounded-none border-0"
          onNodeClick={(stepId) => setSelectedStepId(stepId === selectedStepId ? null : stepId)}
          selectedStepId={selectedStepId}
        />
      </div>

      {/* Step detail panel — slides in from right */}
      {selectedStep && (
        <div className="absolute top-0 right-0 bottom-0 w-80 z-20 border-l bg-background/95 backdrop-blur-sm overflow-y-auto">
          <div className="p-4 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold">Step details</h2>
              <button
                onClick={() => setSelectedStepId(null)}
                className="rounded-md p-1 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <StepDetail step={selectedStep} />
          </div>
        </div>
      )}
    </div>
  );
}

function StepDetail({ step }: { step: WorkflowStep }) {
  const Icon = step.executor === 'human' ? User : step.executor === 'agent' ? Bot : Terminal;

  return (
    <div className="space-y-4">
      {/* Name + type */}
      <div>
        <p className="font-medium">{step.name}</p>
        <p className="font-mono text-xs text-muted-foreground mt-0.5">{step.id}</p>
      </div>

      {/* Badges */}
      <div className="flex flex-wrap gap-1.5">
        <StepTypeBadge type={step.type} />
        <ExecutorBadge executor={step.executor} />
        {step.autonomyLevel && (
          <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
            {step.autonomyLevel}
          </span>
        )}
      </div>

      {step.description && (
        <p className="text-sm text-muted-foreground">{step.description}</p>
      )}

      {/* Plugin */}
      {step.plugin && (
        <Field label="Plugin" value={step.plugin} mono />
      )}

      {/* Allowed roles */}
      {step.allowedRoles && step.allowedRoles.length > 0 && (
        <Field label="Allowed roles" value={step.allowedRoles.join(', ')} />
      )}

      {/* Agent config */}
      {step.agent && (
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Agent config</p>
          {step.agent.model && <Field label="Model" value={step.agent.model} mono />}
          {step.agent.skill && <Field label="Skill" value={step.agent.skill} mono />}
          {step.agent.timeoutMinutes !== undefined && <Field label="Timeout" value={`${step.agent.timeoutMinutes} min`} />}
          {step.agent.confidenceThreshold !== undefined && <Field label="Confidence" value={String(step.agent.confidenceThreshold)} />}
          {step.agent.fallbackBehavior && <Field label="Fallback" value={step.agent.fallbackBehavior} />}
          {step.agent.prompt && (
            <div>
              <p className="text-xs text-muted-foreground mb-1">Prompt</p>
              <p className="text-xs bg-muted rounded p-2 whitespace-pre-wrap">{step.agent.prompt}</p>
            </div>
          )}
        </div>
      )}

      {/* Review config */}
      {step.review && (
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Review config</p>
          {step.review.type && <Field label="Reviewer" value={step.review.type} />}
          {step.review.plugin && <Field label="Plugin" value={step.review.plugin} mono />}
          {step.review.maxIterations !== undefined && <Field label="Max iterations" value={String(step.review.maxIterations)} />}
        </div>
      )}

      {/* Verdicts */}
      {step.verdicts && Object.keys(step.verdicts).length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Verdicts</p>
          {Object.entries(step.verdicts).map(([verdictName, verdict]) => (
            <div key={verdictName} className="flex items-center gap-2 text-xs">
              <span className="font-medium">{verdictName}</span>
              <span className="text-muted-foreground">→</span>
              <span className="font-mono">{verdict.target}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="text-xs text-muted-foreground shrink-0">{label}</span>
      <span className={cn('text-xs text-right truncate', mono && 'font-mono')}>{value}</span>
    </div>
  );
}

function ExecutorBadge({ executor }: { executor: string }) {
  const colors: Record<string, string> = {
    human: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
    agent: 'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400',
    script: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  };
  return (
    <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium capitalize', colors[executor] ?? 'bg-muted text-muted-foreground')}>
      {executor}
    </span>
  );
}

function StepTypeBadge({ type }: { type: string }) {
  const colors: Record<string, string> = {
    creation: 'bg-blue-50 text-blue-600 dark:bg-blue-900/20 dark:text-blue-400',
    review: 'bg-yellow-50 text-yellow-600 dark:bg-yellow-900/20 dark:text-yellow-400',
    decision: 'bg-purple-50 text-purple-600 dark:bg-purple-900/20 dark:text-purple-400',
    terminal: 'bg-muted text-muted-foreground',
  };
  return (
    <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium capitalize', colors[type] ?? 'bg-muted text-muted-foreground')}>
      {type}
    </span>
  );
}
