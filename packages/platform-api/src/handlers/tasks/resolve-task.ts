import type {
  AuditRepository,
  HumanTask,
  HumanTaskRepository,
  ProcessInstanceRepository,
} from '@mediforce/platform-core';
import type {
  ResolveTaskInput,
  ResolveTaskOutput,
} from '../../contract/tasks.js';
import {
  ConflictError,
  HandlerError,
  NotFoundError,
  ValidationError,
} from '../../errors.js';
import type { EngineLike, TriggerRun } from './complete-task.js';

export interface ResolveTaskDeps {
  humanTaskRepo: HumanTaskRepository;
  instanceRepo: ProcessInstanceRepository;
  auditRepo: AuditRepository;
  engine: EngineLike;
  triggerRun?: TriggerRun;
}

/**
 * Pure handler: single code path for resolving any `HumanTask` — verdict,
 * params, or file-upload. Ported 1:1 from the inline
 * `packages/platform-ui/src/lib/resolve-task.ts` helper; kept the original
 * control flow so Phase 2 is purely a move, not a behavioural change.
 *
 * Auto-claims pending tasks as `api-user` before resolving — preserves the
 * pre-migration behaviour where the HTTP endpoint was the ONE place that
 * could skip the "claim → complete" two-step.
 */
export async function resolveTask(
  input: ResolveTaskInput,
  deps: ResolveTaskDeps,
): Promise<ResolveTaskOutput> {
  const { humanTaskRepo, instanceRepo, auditRepo, engine } = deps;
  const { taskId } = input;

  const task = await humanTaskRepo.getById(taskId);
  if (task === null) {
    throw new NotFoundError('Task not found');
  }
  if (task.status === 'completed' || task.status === 'cancelled') {
    throw new ConflictError(`Cannot resolve a ${task.status} task`);
  }

  let resolved: HumanTask = task;
  if (task.status === 'pending') {
    resolved = await humanTaskRepo.claim(taskId, 'api-user');
  }

  const actorId = resolved.assignedUserId ?? 'api-user';
  const isFileUpload = resolved.ui?.component === 'file-upload';
  const isParamsTask =
    Array.isArray(resolved.params) && resolved.params.length > 0;

  if (isFileUpload) {
    const err = validateFileUploadBody(input, resolved);
    if (err !== null) {
      throw new ValidationError(err);
    }
  } else if (isParamsTask) {
    if (input.paramValues === undefined) {
      throw new ValidationError('paramValues object required for params task');
    }
  } else {
    if (input.verdict !== 'approve' && input.verdict !== 'revise') {
      throw new ValidationError('verdict must be "approve" or "revise"');
    }
  }

  const now = new Date().toISOString();

  let completionData: Record<string, unknown>;
  let stepOutput: Record<string, unknown>;

  if (isFileUpload) {
    const attachments = input.attachments ?? [];
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
    const paramValues = input.paramValues ?? {};
    completionData = { paramValues, completedBy: actorId, completedAt: now };
    stepOutput = { ...paramValues };
  } else {
    const verdict = input.verdict as 'approve' | 'revise';
    const comment = input.comment ?? '';
    const selectedIndex = input.selectedIndex;

    const isSelectionReview =
      selectedIndex !== undefined &&
      Array.isArray(resolved.options) &&
      resolved.options.length > 0;

    if (isSelectionReview) {
      if (selectedIndex < 0 || selectedIndex >= resolved.options!.length) {
        throw new ValidationError(
          `selectedIndex ${selectedIndex} out of range (0-${resolved.options!.length - 1})`,
        );
      }

      const selectedOption = resolved.options![selectedIndex] as Record<
        string,
        unknown
      >;
      stepOutput =
        (selectedOption.value as Record<string, unknown>) ?? selectedOption;

      completionData = {
        verdict,
        comment,
        selectedIndex,
        selectedOption,
        completedBy: actorId,
        completedAt: now,
      };
    } else {
      const agentReviewData = resolved.completionData as Record<
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

        if (
          verdict === 'approve' &&
          (agentResult === null ||
            agentResult === undefined ||
            Object.keys(agentResult).length === 0)
        ) {
          // 422 on purpose — "understandable but semantically rejected".
          throw new HandlerError(
            422,
            `Cannot approve step '${resolved.stepId}': agent produced no output`,
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
    }
  }

  await humanTaskRepo.complete(taskId, completionData);

  await auditRepo.append({
    actorId,
    actorType: 'user',
    actorRole: 'operator',
    action: 'task.completed',
    description: isFileUpload
      ? `Task '${taskId}' resolved with ${(input.attachments ?? []).length} file(s) for step '${resolved.stepId}'`
      : isParamsTask
        ? `Task '${taskId}' resolved with param values for step '${resolved.stepId}'`
        : `Task '${taskId}' resolved with verdict '${input.verdict}' for step '${resolved.stepId}'`,
    timestamp: now,
    inputSnapshot: {
      taskId,
      stepId: resolved.stepId,
      ...(isFileUpload
        ? { fileCount: (input.attachments ?? []).length }
        : isParamsTask
          ? { paramKeys: Object.keys(input.paramValues ?? {}) }
          : { verdict: input.verdict }),
    },
    outputSnapshot: { status: 'completed', completionData },
    basis: 'Task resolved via API',
    entityType: 'humanTask',
    entityId: taskId,
    processInstanceId: resolved.processInstanceId,
  });

  const instance = await instanceRepo.getById(resolved.processInstanceId);
  if (instance === null) {
    throw new NotFoundError(
      `Process instance '${resolved.processInstanceId}' not found`,
    );
  }
  if (instance.status !== 'paused') {
    throw new ConflictError(
      `Process instance is '${instance.status}', expected 'paused'`,
    );
  }

  await instanceRepo.update(resolved.processInstanceId, {
    status: 'running',
    pauseReason: null,
    updatedAt: now,
  });

  // L3 agent review with "revise" verdict: stay on the same step so the
  // auto-runner re-executes the agent with feedback. Do NOT advance.
  const isL3Revise =
    resolved.creationReason === 'agent_review_l3' &&
    (stepOutput as Record<string, unknown>).verdict === 'revise';

  if (!isL3Revise) {
    await engine.advanceStep(resolved.processInstanceId, stepOutput, {
      id: actorId,
      role: 'human',
    });
  }

  await auditRepo.append({
    actorId,
    actorType: 'user',
    actorRole: 'operator',
    action: 'process.resumed_after_task',
    description: `Process '${resolved.processInstanceId}' resumed after resolving step '${resolved.stepId}'`,
    timestamp: new Date().toISOString(),
    inputSnapshot: {
      taskId,
      processInstanceId: resolved.processInstanceId,
      stepId: resolved.stepId,
    },
    outputSnapshot: {},
    basis: 'Task resolution triggered process advancement',
    entityType: 'processInstance',
    entityId: resolved.processInstanceId,
    processInstanceId: resolved.processInstanceId,
  });

  if (deps.triggerRun !== undefined) {
    deps.triggerRun(resolved.processInstanceId, actorId);
  }

  const updatedInstance = await instanceRepo.getById(resolved.processInstanceId);

  return {
    ok: true,
    taskId,
    resolvedStepId: resolved.stepId,
    processInstanceId: resolved.processInstanceId,
    nextStepId: updatedInstance?.currentStepId ?? null,
    status: updatedInstance?.status ?? 'unknown',
  };
}

function validateFileUploadBody(
  input: ResolveTaskInput,
  task: HumanTask,
): string | null {
  const attachments = input.attachments;
  if (attachments === undefined || attachments.length === 0) {
    return 'attachments required for file-upload step';
  }

  const uiConfig = task.ui?.config as Record<string, unknown> | undefined;
  if (uiConfig) {
    const minFiles = (uiConfig.minFiles as number) ?? 0;
    const maxFiles = (uiConfig.maxFiles as number) ?? Infinity;
    if (attachments.length < minFiles || attachments.length > maxFiles) {
      return `Expected ${minFiles}-${maxFiles} file(s), got ${attachments.length}`;
    }

    const acceptedTypes = uiConfig.acceptedTypes as string[] | undefined;
    if (acceptedTypes !== undefined && acceptedTypes.length > 0) {
      for (const attachment of attachments) {
        if (!isAcceptedType(attachment.type, attachment.name, acceptedTypes)) {
          return `File type '${attachment.type}' not accepted (allowed: ${acceptedTypes.join(', ')})`;
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
    if (mimeType === accepted) return true;
    if (accepted.endsWith('/*')) {
      const prefix = accepted.slice(0, -1);
      if (mimeType.startsWith(prefix)) return true;
    }
  }
  return false;
}
