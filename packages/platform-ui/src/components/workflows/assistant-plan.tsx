'use client';

import * as React from 'react';
import { HelpCircle, ListChecks } from 'lucide-react';
import type { PlanWorkflowBuildOutput } from '@mediforce/platform-api/contract';
import { cn } from '@/lib/utils';

/**
 * What the assistant is about to do, before it does it — and the few things it
 * could not work out on its own.
 *
 * Only rendered when there is something to ask: a plan with no questions is
 * said in the conversation and the build starts, because stopping to confirm
 * what nobody doubts is the interrogation this exists to avoid. Each question
 * arrives with the answer the assistant would use anyway, so agreeing is one
 * click and correcting is one field.
 */
export function AssistantPlan({
  plan,
  answers,
  onAnswer,
  onBuild,
  onCancel,
}: {
  plan: PlanWorkflowBuildOutput;
  answers: Record<string, string>;
  onAnswer: (id: string, value: string) => void;
  onBuild: () => void;
  onCancel: () => void;
}) {
  const hasPlan = plan.plan.length > 0;
  const questionCount = plan.questions.length;
  const buildLabel = questionCount === 0
    ? 'Build it'
    : hasPlan ? 'Build with these answers' : 'Try again with this';

  return (
    <div className="rounded-lg border bg-muted/30 p-3 space-y-3 text-sm">
      <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        {hasPlan ? (
          <>
            <ListChecks className="h-3.5 w-3.5" />
            Here is what I would build
          </>
        ) : (
          <>
            <HelpCircle className="h-3.5 w-3.5" />
            {questionCount === 1 ? 'I need one thing from you' : `I need ${String(questionCount)} things from you`}
          </>
        )}
      </div>

      {hasPlan && (
        <ul className="space-y-1">
          {plan.plan.map((line, index) => (
            <li key={index} className="flex gap-2">
              <span className="text-muted-foreground/60">•</span>
              <span>{line}</span>
            </li>
          ))}
        </ul>
      )}

      {questionCount > 0 && (
        <div className="space-y-2 border-t pt-3">
          {plan.questions.map((question) => (
            <div key={question.id} className="space-y-1">
              <label className="block text-xs text-muted-foreground">{question.question}</label>
              <input
                value={answers[question.id] ?? question.recommended}
                aria-label={question.question}
                onChange={(e) => onAnswer(question.id, e.target.value)}
                className={cn(
                  'w-full rounded-md border bg-background px-2 py-1 text-xs outline-none',
                  'focus:ring-1 focus:ring-ring focus:border-ring',
                )}
              />
            </div>
          ))}
        </div>
      )}

      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-muted"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onBuild}
          className="rounded-md bg-primary px-3 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90"
        >
          {buildLabel}
        </button>
      </div>
    </div>
  );
}

/** The answers, as the one message the build reads them from. */
export function answersMessage(
  plan: PlanWorkflowBuildOutput,
  answers: Record<string, string>,
): string {
  return plan.questions
    .map((question) => `${question.question} ${answers[question.id] ?? question.recommended}`)
    .join('\n');
}
