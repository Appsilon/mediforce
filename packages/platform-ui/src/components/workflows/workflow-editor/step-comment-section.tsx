'use client';

import {
  commentVerdictKeys,
  resolveRequiresComment,
  type WorkflowStep,
} from '@mediforce/platform-core';
import { FieldGroup, FieldRow, Section } from './step-editor-fields';

type StepComment = WorkflowStep['comment'];

const REQUIRED_TOOLTIP =
  'Enforced server-side — the task cannot be completed on a ticked verdict without a comment. On an agent review, the comment is what tells the agent what to change, so an empty "revise" re-runs it with no feedback.';

export function commentAfterVerdictRename(comment: StepComment, from: string, to: string): StepComment {
  if (comment === undefined) return undefined;
  return { requiredForVerdicts: comment.requiredForVerdicts.map((key) => (key === from ? to : key)) };
}

export function commentAfterVerdictDelete(comment: StepComment, deleted: string): StepComment {
  if (comment === undefined) return undefined;
  return { requiredForVerdicts: comment.requiredForVerdicts.filter((key) => key !== deleted) };
}

export function StepCommentSection({
  step,
  onChange,
}: {
  step: WorkflowStep;
  onChange: (patch: Partial<WorkflowStep>) => void;
}) {
  const verdictKeys = commentVerdictKeys(step);
  const isRequired = (key: string) => resolveRequiresComment(key, step.verdicts?.[key], step.comment);

  function toggle(toggled: string, checked: boolean) {
    const requiredForVerdicts = verdictKeys.filter((key) => (key === toggled ? checked : isRequired(key)));
    // The step setting takes over from here, so no verdict keeps a stale value of its own.
    const verdicts = step.verdicts === undefined
      ? undefined
      : Object.fromEntries(
          Object.entries(step.verdicts).map(([key, { requiresComment: _replaced, ...verdict }]) => [key, verdict]),
        );
    onChange({ comment: { requiredForVerdicts }, ...(verdicts !== undefined ? { verdicts } : {}) });
  }

  if (verdictKeys.length === 0) return null;

  return (
    <Section title="Comment">
      <FieldGroup>
        <FieldRow label="requiredForVerdicts" tooltip={REQUIRED_TOOLTIP}>
          <div className="flex flex-wrap items-center gap-2">
            {verdictKeys.map((key) => (
              <label key={key} className="flex items-center gap-1 text-[11px] text-muted-foreground">
                <input
                  type="checkbox"
                  aria-label={`Comment required for ${key}`}
                  checked={isRequired(key)}
                  onChange={(e) => toggle(key, e.target.checked)}
                  className="h-3.5 w-3.5 accent-primary cursor-pointer"
                />
                {key}
              </label>
            ))}
          </div>
        </FieldRow>
      </FieldGroup>
    </Section>
  );
}
