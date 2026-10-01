'use client';

import * as React from 'react';
import { FileText, Loader2 } from 'lucide-react';
import type { EvaluatedStep } from '@mediforce/platform-core';
import { mediforce } from '@/lib/mediforce';
import { cn } from '@/lib/utils';
import { MarkdownPresentation } from '@/components/tasks/markdown-presentation';
import { useStepEvaluationMutation, type useStepEvaluation } from '@/hooks/use-step-evaluation';
import { buttonClass, inputClass, primaryButtonClass } from './evaluation-styles';

export type BriefQuery = ReturnType<typeof useStepEvaluation>['brief'];

/** The header icon that shows and hides the Step's Brief; a dot marks one that is written. */
export function EvaluationBriefToggle({ brief, open, onToggle }: { brief: BriefQuery; open: boolean; onToggle: () => void }) {
  const label = open ? 'Hide the step brief' : 'Show the step brief';
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={label}
      aria-expanded={open}
      title={label}
      className={cn('relative rounded-md p-1 transition-colors hover:bg-muted', open ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground')}
    >
      <FileText className="h-4 w-4" />
      {(brief.data?.brief ?? null) !== null && (
        <span
          data-testid="brief-indicator"
          aria-hidden="true"
          className="absolute right-0 top-0 h-1.5 w-1.5 rounded-full bg-green-500 ring-1 ring-background"
        />
      )}
    </button>
  );
}

/**
 * The Step's Evaluation Brief (ADR-0023 D16): its context of use, read by the
 * assistant on every turn. It belongs to the Step, not to whoever opens the
 * panel, so every save is a new version everyone evaluating the Step shares.
 */
export function EvaluationBriefField({ step, brief: query, mayEdit }: { step: EvaluatedStep; brief: BriefQuery; mayEdit: boolean }) {
  const [draft, setDraft] = React.useState<string | null>(null);
  const save = useStepEvaluationMutation(step, (text: string) => mediforce.evaluation.setBrief({ ...step, text }));
  const brief = query.data?.brief ?? null;
  return (
    <div className="space-y-1.5 text-xs" data-testid="evaluation-brief">
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium text-muted-foreground">Step brief</span>
        {mayEdit && draft === null && query.isError === false && (
          <button type="button" className={buttonClass} onClick={() => setDraft(brief?.text ?? '')}>{brief === null ? 'Write' : 'Edit'}</button>
        )}
      </div>
      <p className="text-muted-foreground" data-testid="brief-purpose">
        What this step is for, who relies on its output and which failures matter most. The assistant reads it on every turn; it is shared with everyone evaluating this step.
      </p>
      {query.isLoading ? <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" /> : query.isError && draft === null ? (
        <div role="alert" className="flex items-center justify-between gap-2 text-destructive">
          <span>Could not load the step brief.</span>
          <button type="button" className={buttonClass} onClick={() => void query.refetch()}>Retry</button>
        </div>
      ) : draft !== null ? (
        <div className="space-y-2">
          <textarea
            aria-label="Step brief"
            className={cn(inputClass, 'w-full min-h-24')}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="What this step is for, who relies on its output, which failures matter most."
          />
          <div className="flex gap-2">
            <button
              type="button"
              className={primaryButtonClass}
              disabled={draft.trim() === '' || save.isPending}
              onClick={() => save.mutate(draft, { onSuccess: () => setDraft(null) })}
            >Save as v{(brief?.version ?? 0) + 1}</button>
            <button type="button" className={buttonClass} onClick={() => setDraft(null)}>Cancel</button>
          </div>
        </div>
      ) : brief === null ? (
        <p className="text-muted-foreground">No Brief yet. Write one, or ask the assistant to draft it.</p>
      ) : (
        <div className="max-h-48 space-y-1 overflow-y-auto">
          <MarkdownPresentation content={brief.text} />
          <p className="text-muted-foreground">v{brief.version} · {brief.origin === 'assistant' ? 'drafted by the assistant' : 'written'} by {brief.createdBy}</p>
        </div>
      )}
    </div>
  );
}
