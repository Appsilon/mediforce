import type { HumanTask } from '@mediforce/platform-core';
import { getPlatformServices, getAppBaseUrl } from '@/lib/platform-services';

// ── Result types ─────────────────────────────────────────────────────────────

export interface ResolveSuccess {
  ok: true;
  taskId: string;
  resolvedStepId: string;
  processInstanceId: string;
  nextStepId: string | null;
  status: string;
}

export interface ResolveError {
  error: string;
  httpStatus: number;
}

export type ResolveResult = ResolveSuccess | ResolveError;

export function isResolveError(result: ResolveResult): result is ResolveError {
  return 'error' in result;
}

// ── Core resolution logic ────────────────────────────────────────────────────

/**
 * Single code path for resolving any HumanTask (verdict, params, file-upload).
 *
 * Handles: load → validate → auto-claim → build stepOutput → complete task →
 * audit → resume process → advance step → trigger auto-runner.
 *
 * Body shapes:
 * - Verdict:     { verdict: "approve"|"revise", comment?: string }
 * - Params:      { paramValues: Record<string, unknown> }
 * - File upload: { attachments: Attachment[] }
 */
export async function resolveTask(
  taskId: string,
  body: Record<string, unknown>,
): Promise<ResolveResult> {
  const { humanTaskRepo, instanceRepo, auditRepo, engine } =
    getPlatformServices();

  // ── 1. Load task ────────────────────────────────────────────────────────
  const task = await humanTaskRepo.getById(taskId);
  if (!task) {
    return { error: 'Task not found', httpStatus: 404 };
  }

  if (task.status === 'completed' || task.status === 'cancelled') {
    return { error: `Cannot resolve a ${task.status} task`, httpStatus: 409 };
  }

  // ── 2. Auto-claim if pending ────────────────────────────────────────────
  let resolvedTask: HumanTask = task;
  if (task.status === 'pending') {
    resolvedTask = await humanTaskRepo.claim(taskId, 'api-user');
  }

  const actorId = resolvedTask.assignedUserId ?? 'api-user';
  const isFileUpload = resolvedTask.ui?.component === 'file-upload';
  const isParamsTask =
    Array.isArray(resolvedTask.params) && resolvedTask.params.length > 0;

  // ── 3. Validate body based on task type ─────────────────────────────────
  if (isFileUpload) {
    const validationError = validateFileUploadBody(body, resolvedTask);
    if (validationError) {
      return { error: validationError, httpStatus: 400 };
    }
  } else if (isParamsTask) {
    if (!body.paramValues || typeof body.paramValues !== 'object') {
      return {
        error: 'paramValues object required for params task',
        httpStatus: 400,
      };
    }
  } else {
    const verdict = body.verdict;
    if (verdict !== 'approve' && verdict !== 'revise') {
      return {
        error: 'verdict must be "approve" or "revise"',
        httpStatus: 400,
      };
    }
  }

  const now = new Date().toISOString();

  // ── 4. Build completionData + stepOutput ────────────────────────────────
  // stepOutput = semantic output of the step (what downstream steps consume).
  // Task metadata stays in completionData / stepExecution fields.
  let completionData: Record<string, unknown>;
  let stepOutput: Record<string, unknown>;

  if (isFileUpload) {
    const attachments = body.attachments as Attachment[];
    const files = attachments.map((file) => ({
      name: file.name,
      size: file.size,
      type: file.type,
      storagePath: file.storagePath ?? null,
      downloadUrl: file.downloadUrl ?? null,
      uploadedAt: now,
    }));

    completionData = { files, completedBy: actorId, completedAt: now };
    stepOutput = { files };
  } else if (isParamsTask) {
    const paramValues = body.paramValues as Record<string, unknown>;
    completionData = { paramValues, completedBy: actorId, completedAt: now };
    stepOutput = paramValues;
  } else {
    const verdict = body.verdict as string;
    const comment = (body.comment as string) ?? '';
    const selectedIndex = body.selectedIndex as number | undefined;

    // Selection review: reviewer picked one of N options
    const isSelectionReview =
      selectedIndex !== undefined &&
      Array.isArray(resolvedTask.options) &&
      resolvedTask.options.length > 0;

    if (isSelectionReview) {
      if (
        !Number.isInteger(selectedIndex) ||
        selectedIndex < 0 ||
        selectedIndex >= resolvedTask.options!.length
      ) {
        return {
          error: `selectedIndex ${selectedIndex} out of range (0-${resolvedTask.options!.length - 1})`,
          httpStatus: 400,
        };
      }

      const selectedOption = resolvedTask.options![selectedIndex] as Record<string, unknown>;
      // The option's `value` field is the semantic output; fall back to the full option object
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
      // L3 agent review: semantic output is the agent's actual result
      const agentReviewData = resolvedTask.completionData as Record<
        string,
        unknown
      > | null;
      const agentOutput = agentReviewData?.agentOutput as
        | Record<string, unknown>
        | undefined;

      if (agentReviewData?.reviewType === 'agent_output_review') {
        const agentResult = agentOutput?.result as
          | Record<string, unknown>
          | null
          | undefined;

        // Reject approval when agent produced no output
        if (
          verdict === 'approve' &&
          (agentResult === null ||
            agentResult === undefined ||
            Object.keys(agentResult).length === 0)
        ) {
          return {
            error: `Cannot approve step '${resolvedTask.stepId}': agent produced no output`,
            httpStatus: 422,
          };
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

    // Verdict must be in stepOutput for verdict-based routing
    stepOutput.verdict = verdict;

    // Reviewer comment flows to downstream steps as context
    if (comment.length > 0) {
      stepOutput.reviewerComment = comment;
    }
  }

  // ── 5. Complete the task ────────────────────────────────────────────────
  await humanTaskRepo.complete(taskId, completionData);

  await auditRepo.append({
    actorId,
    actorType: 'user',
    actorRole: 'operator',
    action: 'task.completed',
    description: isFileUpload
      ? `Task '${taskId}' resolved with ${(body.attachments as Attachment[]).length} file(s) for step '${resolvedTask.stepId}'`
      : isParamsTask
        ? `Task '${taskId}' resolved with param values for step '${resolvedTask.stepId}'`
        : `Task '${taskId}' resolved with verdict '${body.verdict}' for step '${resolvedTask.stepId}'`,
    timestamp: now,
    inputSnapshot: {
      taskId,
      stepId: resolvedTask.stepId,
      ...(isFileUpload
        ? { fileCount: (body.attachments as Attachment[]).length }
        : isParamsTask
          ? {
              paramKeys: Object.keys(
                body.paramValues as Record<string, unknown>,
              ),
            }
          : { verdict: body.verdict }),
    },
    outputSnapshot: { status: 'completed', completionData },
    basis: 'Task resolved via API',
    entityType: 'humanTask',
    entityId: taskId,
    processInstanceId: resolvedTask.processInstanceId,
  });

  // ── 6. Resume paused process ────────────────────────────────────────────
  const instance = await instanceRepo.getById(resolvedTask.processInstanceId);
  if (!instance) {
    return {
      error: `Process instance '${resolvedTask.processInstanceId}' not found`,
      httpStatus: 404,
    };
  }

  if (instance.status !== 'paused') {
    return {
      error: `Process instance is '${instance.status}', expected 'paused'`,
      httpStatus: 409,
    };
  }

  await instanceRepo.update(resolvedTask.processInstanceId, {
    status: 'running',
    pauseReason: null,
    updatedAt: now,
  });

  // ── 7. Advance to next step ─────────────────────────────────────────────
  // L3 agent review with "revise" verdict: do NOT advance — keep instance on
  // the same step so the auto-runner re-executes the agent with feedback.
  const isL3Revise =
    resolvedTask.creationReason === 'agent_review_l3' &&
    (stepOutput as Record<string, unknown>).verdict === 'revise';

  const isWorkflowInstance = !instance.configName;

  if (!isL3Revise) {
    if (isWorkflowInstance) {
      await engine.advanceWorkflowStep(resolvedTask.processInstanceId, stepOutput, {
        id: actorId,
        role: 'human',
      });
    } else {
      await engine.advanceStep(resolvedTask.processInstanceId, stepOutput, {
        id: actorId,
        role: 'human',
      });
    }
  }

  await auditRepo.append({
    actorId,
    actorType: 'user',
    actorRole: 'operator',
    action: 'process.resumed_after_task',
    description: `Process '${resolvedTask.processInstanceId}' resumed after resolving step '${resolvedTask.stepId}'`,
    timestamp: new Date().toISOString(),
    inputSnapshot: {
      taskId,
      processInstanceId: resolvedTask.processInstanceId,
      stepId: resolvedTask.stepId,
    },
    outputSnapshot: {},
    basis: 'Task resolution triggered process advancement',
    entityType: 'processInstance',
    entityId: resolvedTask.processInstanceId,
    processInstanceId: resolvedTask.processInstanceId,
  });

  // ── 8. Trigger auto-runner for subsequent agent steps ───────────────────
  const appUrl = getAppBaseUrl();
  fetch(`${appUrl}/api/processes/${resolvedTask.processInstanceId}/run`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Api-Key': process.env.PLATFORM_API_KEY ?? '',
    },
    body: JSON.stringify({ triggeredBy: actorId }),
  }).catch(() => {});

  // ── 9. Build response ──────────────────────────────────────────────────
  const updatedInstance = await instanceRepo.getById(
    resolvedTask.processInstanceId,
  );

  return {
    ok: true,
    taskId,
    resolvedStepId: resolvedTask.stepId,
    processInstanceId: resolvedTask.processInstanceId,
    nextStepId: updatedInstance?.currentStepId ?? null,
    status: updatedInstance?.status ?? 'unknown',
  };
}

// ── Validation helpers ───────────────────────────────────────────────────────

interface Attachment {
  name: string;
  size: number;
  type: string;
  storagePath?: string;
  downloadUrl?: string;
}

function validateFileUploadBody(
  body: Record<string, unknown>,
  task: HumanTask,
): string | null {
  const attachments = body.attachments;
  if (!Array.isArray(attachments) || attachments.length === 0) {
    return 'attachments required for file-upload step';
  }

  for (let index = 0; index < attachments.length; index++) {
    const attachment = attachments[index] as Record<string, unknown>;
    if (typeof attachment.name !== 'string' || attachment.name.length === 0) {
      return `attachments[${index}].name is required`;
    }
    if (typeof attachment.size !== 'number' || attachment.size <= 0) {
      return `attachments[${index}].size must be a positive number`;
    }
    if (typeof attachment.type !== 'string' || attachment.type.length === 0) {
      return `attachments[${index}].type is required`;
    }
  }

  const uiConfig = task.ui?.config as Record<string, unknown> | undefined;
  if (uiConfig) {
    const minFiles = (uiConfig.minFiles as number) ?? 0;
    const maxFiles = (uiConfig.maxFiles as number) ?? Infinity;

    if (attachments.length < minFiles || attachments.length > maxFiles) {
      return `Expected ${minFiles}-${maxFiles} file(s), got ${attachments.length}`;
    }

    const acceptedTypes = uiConfig.acceptedTypes as string[] | undefined;
    if (acceptedTypes && acceptedTypes.length > 0) {
      for (const attachment of attachments) {
        const fileType = (attachment as Record<string, unknown>).type as string;
        const fileName = (attachment as Record<string, unknown>)
          .name as string;
        if (!isAcceptedType(fileType, fileName, acceptedTypes)) {
          return `File type '${fileType}' not accepted (allowed: ${acceptedTypes.join(', ')})`;
        }
      }
    }
  }

  return null;
}

function isAcceptedType(
  mimeType: string,
  fileName: string,
  acceptedTypes: string[],
): boolean {
  for (const accepted of acceptedTypes) {
    if (accepted.startsWith('.')) {
      if (fileName.toLowerCase().endsWith(accepted.toLowerCase())) {
        return true;
      }
      continue;
    }
    if (mimeType === accepted) {
      return true;
    }
    if (accepted.endsWith('/*')) {
      const prefix = accepted.slice(0, -1);
      if (mimeType.startsWith(prefix)) {
        return true;
      }
    }
  }
  return false;
}
