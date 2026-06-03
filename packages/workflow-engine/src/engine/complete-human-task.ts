import type {
  HumanTask,
  CompleteHumanTaskPayload,
  Attachment,
} from '@mediforce/platform-core';
import { CompleteHumanTaskValidationError } from './errors';

// Pure helpers backing engine.completeHumanTask. Split out so per-variant
// validation + stepOutput shaping is unit-testable without engine wiring.

interface StepOutputBundle {
  readonly completionData: Record<string, unknown>;
  readonly stepOutput: Record<string, unknown>;
}

export type TaskKind = 'verdict' | 'params' | 'verdict-with-params' | 'upload' | 'assignment' | 'rows';

export function resolveTaskKind(task: HumanTask): TaskKind {
  const component = task.ui?.component;
  if (component === 'file-upload') return 'upload';
  if (component === 'assignment-table') return 'assignment';
  if (component === 'table-editor') return 'rows';
  const hasParams = Array.isArray(task.params) && task.params.length > 0;
  const hasVerdicts = Array.isArray(task.verdicts) && task.verdicts.length > 0;
  if (hasParams && hasVerdicts) return 'verdict-with-params';
  if (hasParams) return 'params';
  return 'verdict';
}

export function validatePayloadKindMatchesTask(
  task: HumanTask,
  payload: CompleteHumanTaskPayload,
): void {
  const expected = resolveTaskKind(task);
  if (payload.kind !== expected) {
    throw new CompleteHumanTaskValidationError(
      `payload.kind '${payload.kind}' does not match task type '${expected}'`,
      { taskKind: expected, payloadKind: payload.kind, taskId: task.id },
    );
  }
}

// ── verdict ──────────────────────────────────────────────────────────────────

export function validateVerdictPayload(
  task: HumanTask,
  payload: Extract<CompleteHumanTaskPayload, { kind: 'verdict' }>,
): void {
  const { verdict, comment } = payload;

  const taskVerdicts = task.verdicts;
  const descriptor = taskVerdicts?.find((v) => v.key === verdict);
  const allowed = taskVerdicts
    ? descriptor !== undefined
    : verdict === 'approve' || verdict === 'revise';
  if (!allowed) {
    const allowedKeys = taskVerdicts
      ? taskVerdicts.map((v) => v.key).join(', ')
      : 'approve, revise';
    throw new CompleteHumanTaskValidationError(
      `verdict '${verdict}' not allowed for step '${task.stepId}' — must be one of: ${allowedKeys}`,
      { stepId: task.stepId, verdict, allowed: allowedKeys },
    );
  }

  if (descriptor?.requiresComment) {
    const trimmed = typeof comment === 'string' ? comment.trim() : '';
    if (trimmed.length === 0) {
      throw new CompleteHumanTaskValidationError(
        `verdict '${verdict}' requires a non-empty comment`,
        { stepId: task.stepId, verdict },
      );
    }
  }

  if (payload.selectedIndex !== undefined) {
    if (!Array.isArray(task.options) || task.options.length === 0) {
      throw new CompleteHumanTaskValidationError(
        'selectedIndex supplied but task has no options',
        { stepId: task.stepId },
      );
    }
    if (payload.selectedIndex >= task.options.length) {
      throw new CompleteHumanTaskValidationError(
        `selectedIndex ${payload.selectedIndex} out of range (0-${task.options.length - 1})`,
        { stepId: task.stepId, selectedIndex: payload.selectedIndex, optionCount: task.options.length },
      );
    }
  }
}

export function buildVerdictStepOutput(
  task: HumanTask,
  payload: Extract<CompleteHumanTaskPayload, { kind: 'verdict' }>,
  actorId: string,
  now: string,
): StepOutputBundle & { isL3Revise: boolean } {
  const { verdict } = payload;
  const comment = payload.comment ?? '';
  const selectedIndex = payload.selectedIndex;

  const isSelectionReview =
    selectedIndex !== undefined &&
    Array.isArray(task.options) &&
    task.options.length > 0;

  let completionData: Record<string, unknown>;
  let stepOutput: Record<string, unknown>;

  if (isSelectionReview) {
    const selectedOption = task.options![selectedIndex!] as Record<string, unknown>;
    stepOutput = (selectedOption.value as Record<string, unknown>) ?? selectedOption;
    completionData = {
      verdict,
      comment,
      selectedIndex,
      selectedOption,
      completedBy: actorId,
      completedAt: now,
    };
  } else {
    const agentReviewData = task.completionData as Record<string, unknown> | null;
    const agentOutput = agentReviewData?.agentOutput as Record<string, unknown> | undefined;

    if (agentReviewData?.reviewType === 'agent_output_review') {
      const agentResult = agentOutput?.result as Record<string, unknown> | null | undefined;

      // Block rubber-stamping an empty agent run.
      if (
        verdict === 'approve' &&
        (agentResult === null ||
          agentResult === undefined ||
          Object.keys(agentResult).length === 0)
      ) {
        throw new CompleteHumanTaskValidationError(
          `Cannot approve step '${task.stepId}': agent produced no output`,
          { stepId: task.stepId },
        );
      }

      stepOutput = agentResult ?? {};
    } else {
      stepOutput = {};
    }

    completionData = {
      verdict,
      comment,
      completedBy: actorId,
      completedAt: now,
      ...(agentOutput !== undefined ? { agentOutput } : {}),
    };
  }

  stepOutput.verdict = verdict;
  if (comment.length > 0) {
    stepOutput.reviewerComment = comment;
    stepOutput.reviewerCallToAction =
      `=== REVIEWER FEEDBACK ON PRIOR ITERATION (verdict=${verdict}) ===\n` +
      `\n` +
      `THIS IS THE SOURCE OF TRUTH for this iteration. Address it before ` +
      `anything else. Do not return the same output as the prior iteration ` +
      `unless the comment explicitly approves it.\n` +
      `\n` +
      `${comment}\n` +
      `\n` +
      `=== END REVIEWER FEEDBACK ===`;
  }

  const isL3Revise =
    task.creationReason === 'agent_review_l3' && verdict === 'revise';

  return { completionData, stepOutput, isL3Revise };
}

// ── params ───────────────────────────────────────────────────────────────────

export function buildParamsStepOutput(
  payload: Extract<CompleteHumanTaskPayload, { kind: 'params' }>,
  actorId: string,
  now: string,
): StepOutputBundle {
  return {
    completionData: {
      paramValues: payload.paramValues,
      completedBy: actorId,
      completedAt: now,
    },
    stepOutput: payload.paramValues,
  };
}

// ── upload ───────────────────────────────────────────────────────────────────

export function validateUploadPayload(
  task: HumanTask,
  payload: Extract<CompleteHumanTaskPayload, { kind: 'upload' }>,
): void {
  const uiConfig = task.ui?.config as Record<string, unknown> | undefined;
  if (!uiConfig) return;

  const attachments = payload.attachments;
  const minFiles = (uiConfig.minFiles as number) ?? 0;
  const maxFiles = (uiConfig.maxFiles as number) ?? Infinity;

  if (attachments.length < minFiles || attachments.length > maxFiles) {
    throw new CompleteHumanTaskValidationError(
      `Expected ${minFiles}-${maxFiles} file(s), got ${attachments.length}`,
      { minFiles, maxFiles, count: attachments.length },
    );
  }

  const acceptedTypes = uiConfig.acceptedTypes as string[] | undefined;
  if (acceptedTypes && acceptedTypes.length > 0) {
    for (const attachment of attachments) {
      if (!isAcceptedType(attachment.type, attachment.name, acceptedTypes)) {
        throw new CompleteHumanTaskValidationError(
          `File type '${attachment.type}' not accepted (allowed: ${acceptedTypes.join(', ')})`,
          { fileType: attachment.type, fileName: attachment.name, acceptedTypes },
        );
      }
    }
  }
}

export function buildUploadStepOutput(
  payload: Extract<CompleteHumanTaskPayload, { kind: 'upload' }>,
  actorId: string,
  now: string,
): StepOutputBundle {
  const files = payload.attachments.map((file: Attachment) => ({
    name: file.name,
    size: file.size,
    type: file.type,
    storagePath: file.storagePath ?? null,
    downloadUrl: file.downloadUrl ?? null,
    uploadedAt: now,
  }));
  return {
    completionData: { files, completedBy: actorId, completedAt: now },
    stepOutput: { files },
  };
}

function isAcceptedType(
  mimeType: string,
  fileName: string,
  acceptedTypes: readonly string[],
): boolean {
  for (const accepted of acceptedTypes) {
    if (accepted.startsWith('.')) {
      if (fileName.toLowerCase().endsWith(accepted.toLowerCase())) return true;
      continue;
    }
    if (mimeType === accepted) return true;
    if (accepted.endsWith('/*') && mimeType.startsWith(accepted.slice(0, -1))) return true;
  }
  return false;
}

// ── assignment ───────────────────────────────────────────────────────────────

export function buildAssignmentStepOutput(
  payload: Extract<CompleteHumanTaskPayload, { kind: 'assignment' }>,
  actorId: string,
  now: string,
): StepOutputBundle {
  return {
    completionData: {
      assignments: payload.assignments,
      completedBy: actorId,
      completedAt: now,
    },
    stepOutput: { assignments: payload.assignments },
  };
}

// ── rows (table-editor) ──────────────────────────────────────────────────────

export function buildRowsStepOutput(
  payload: Extract<CompleteHumanTaskPayload, { kind: 'rows' }>,
  actorId: string,
  now: string,
): StepOutputBundle {
  return {
    completionData: {
      rows: payload.rows,
      completedBy: actorId,
      completedAt: now,
    },
    stepOutput: { rows: payload.rows },
  };
}

export interface CompletionShape {
  readonly completionData: Record<string, unknown>;
  readonly stepOutput: Record<string, unknown>;
  readonly isL3Revise: boolean;
}

export function shapeCompletion(
  task: HumanTask,
  payload: CompleteHumanTaskPayload,
  actorId: string,
  now: string,
): CompletionShape {
  validatePayloadKindMatchesTask(task, payload);

  switch (payload.kind) {
    case 'verdict': {
      validateVerdictPayload(task, payload);
      return buildVerdictStepOutput(task, payload, actorId, now);
    }
    case 'params': {
      return { ...buildParamsStepOutput(payload, actorId, now), isL3Revise: false };
    }
    case 'verdict-with-params': {
      validateVerdictPayload(task, { kind: 'verdict', verdict: payload.verdict, comment: payload.comment });
      const stepOutput: Record<string, unknown> = {
        ...payload.paramValues,
        verdict: payload.verdict,
      };
      if (payload.comment && payload.comment.trim().length > 0) {
        stepOutput.comment = payload.comment.trim();
      }
      return {
        completionData: {
          verdict: payload.verdict,
          comment: payload.comment ?? '',
          paramValues: payload.paramValues,
          completedBy: actorId,
          completedAt: now,
        },
        stepOutput,
        isL3Revise: false,
      };
    }
    case 'upload': {
      validateUploadPayload(task, payload);
      return { ...buildUploadStepOutput(payload, actorId, now), isL3Revise: false };
    }
    case 'assignment': {
      return { ...buildAssignmentStepOutput(payload, actorId, now), isL3Revise: false };
    }
    case 'rows': {
      return { ...buildRowsStepOutput(payload, actorId, now), isL3Revise: false };
    }
  }
}
