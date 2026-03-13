import { NextRequest, NextResponse } from 'next/server';
import { getPlatformServices, validateApiKey, getAppBaseUrl } from '@/lib/platform-services';
import type { HumanTask } from '@mediforce/platform-core';

/**
 * POST /api/tasks/:taskId/resolve
 *
 * Generic task resolution endpoint. Inspects the task's UI config to determine
 * the resolution shape:
 *
 * File-upload steps (ui.component === 'file-upload'):
 *   Body: { "attachments": [{ name, size, type, storagePath, downloadUrl }] }
 *
 * Verdict steps (everything else):
 *   Body: { "verdict": "approve" | "revise", "comment": "..." }
 *
 * Auto-claims pending tasks before resolving.
 * Resumes the paused process, advances to the next step,
 * and triggers the auto-runner for subsequent agent steps.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ taskId: string }> },
): Promise<NextResponse> {
  if (!validateApiKey(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { taskId } = await params;
    const body = (await req.json()) as Record<string, unknown>;

    const { humanTaskRepo, instanceRepo, auditRepo, engine } =
      getPlatformServices();

    // ── 1. Load task ────────────────────────────────────────────────────
    const task = await humanTaskRepo.getById(taskId);
    if (!task) {
      return NextResponse.json({ error: 'Task not found' }, { status: 404 });
    }

    if (task.status === 'completed' || task.status === 'cancelled') {
      return NextResponse.json(
        { error: `Cannot resolve a ${task.status} task` },
        { status: 409 },
      );
    }

    // ── 2. Auto-claim if pending ────────────────────────────────────────
    let resolvedTask: HumanTask = task;
    if (task.status === 'pending') {
      resolvedTask = await humanTaskRepo.claim(taskId, 'api-user');
    }

    const actorId = resolvedTask.assignedUserId ?? 'api-user';
    const isFileUpload = resolvedTask.ui?.component === 'file-upload';

    // ── 3. Validate body based on task type ─────────────────────────────
    if (isFileUpload) {
      const validationError = validateFileUploadBody(body, resolvedTask);
      if (validationError) {
        return NextResponse.json({ error: validationError }, { status: 400 });
      }
    } else {
      const verdict = body.verdict;
      if (verdict !== 'approve' && verdict !== 'revise') {
        return NextResponse.json(
          { error: 'verdict must be "approve" or "revise"' },
          { status: 400 },
        );
      }
    }

    const now = new Date().toISOString();

    // ── 4. Build completionData + stepOutput ─────────────────────────────
    // stepOutput = semantic output of the step (what downstream steps consume).
    // Task metadata (verdict, comment, taskId) stays in completionData / stepExecution fields.
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
    } else {
      const verdict = body.verdict as string;
      const comment = (body.comment as string) ?? '';
      completionData = { verdict, comment, completedBy: actorId, completedAt: now };

      // L3 agent review: semantic output is the agent's actual result
      const agentReviewData = resolvedTask.completionData as Record<string, unknown> | null;
      if (agentReviewData?.reviewType === 'agent_output_review') {
        const agentOutput = agentReviewData.agentOutput as Record<string, unknown> | undefined;
        const agentResult = agentOutput?.result as Record<string, unknown> | null | undefined;

        // Reject approval when agent produced no output — prevents auto-advance
        // from advancing steps that failed silently or completed without results
        if (agentResult === null || agentResult === undefined || Object.keys(agentResult).length === 0) {
          return NextResponse.json(
            { error: `Cannot approve step '${resolvedTask.stepId}': agent produced no output` },
            { status: 422 },
          );
        }

        stepOutput = agentResult;
      } else {
        stepOutput = {};
      }

      // Reviewer comment flows to downstream steps as context
      if (comment.length > 0) {
        stepOutput.reviewerComment = comment;
      }
    }

    // ── 5. Complete the task ─────────────────────────────────────────────
    await humanTaskRepo.complete(taskId, completionData);

    await auditRepo.append({
      actorId,
      actorType: 'user',
      actorRole: 'operator',
      action: 'task.completed',
      description: isFileUpload
        ? `Task '${taskId}' resolved with ${(body.attachments as Attachment[]).length} file(s) for step '${resolvedTask.stepId}'`
        : `Task '${taskId}' resolved with verdict '${body.verdict}' for step '${resolvedTask.stepId}'`,
      timestamp: now,
      inputSnapshot: { taskId, stepId: resolvedTask.stepId, ...(isFileUpload ? { fileCount: (body.attachments as Attachment[]).length } : { verdict: body.verdict }) },
      outputSnapshot: { status: 'completed', completionData },
      basis: 'Task resolved via API',
      entityType: 'humanTask',
      entityId: taskId,
      processInstanceId: resolvedTask.processInstanceId,
    });

    // ── 6. Resume paused process ─────────────────────────────────────────
    const instance = await instanceRepo.getById(resolvedTask.processInstanceId);
    if (!instance) {
      return NextResponse.json(
        { error: `Process instance '${resolvedTask.processInstanceId}' not found` },
        { status: 404 },
      );
    }

    if (instance.status !== 'paused') {
      return NextResponse.json(
        { error: `Process instance is '${instance.status}', expected 'paused'` },
        { status: 409 },
      );
    }

    await instanceRepo.update(resolvedTask.processInstanceId, {
      status: 'running',
      pauseReason: null,
      updatedAt: now,
    });

    // ── 7. Advance to next step ──────────────────────────────────────────
    await engine.advanceStep(
      resolvedTask.processInstanceId,
      stepOutput,
      { id: actorId, role: 'human' },
    );

    await auditRepo.append({
      actorId,
      actorType: 'user',
      actorRole: 'operator',
      action: 'process.resumed_after_task',
      description: `Process '${resolvedTask.processInstanceId}' resumed after resolving step '${resolvedTask.stepId}'`,
      timestamp: new Date().toISOString(),
      inputSnapshot: { taskId, processInstanceId: resolvedTask.processInstanceId, stepId: resolvedTask.stepId },
      outputSnapshot: {},
      basis: 'Task resolution via API triggered process advancement',
      entityType: 'processInstance',
      entityId: resolvedTask.processInstanceId,
      processInstanceId: resolvedTask.processInstanceId,
    });

    // ── 8. Trigger auto-runner for subsequent agent steps ─────────────────
    const appUrl = getAppBaseUrl();
    fetch(`${appUrl}/api/processes/${resolvedTask.processInstanceId}/run`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Api-Key': process.env.PLATFORM_API_KEY ?? '',
      },
      body: JSON.stringify({ triggeredBy: actorId }),
    }).catch(() => {});

    // ── 9. Build response ────────────────────────────────────────────────
    const updatedInstance = await instanceRepo.getById(resolvedTask.processInstanceId);

    return NextResponse.json({
      ok: true,
      taskId,
      resolvedStepId: resolvedTask.stepId,
      processInstanceId: resolvedTask.processInstanceId,
      nextStepId: updatedInstance?.currentStepId ?? null,
      status: updatedInstance?.status ?? 'unknown',
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// ── Validation helpers ──────────────────────────────────────────────────────

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

  // Validate each attachment has required fields
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

  // Validate against UI config constraints
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
        const fileName = (attachment as Record<string, unknown>).name as string;
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
    // Extension match (e.g., ".xpt", ".csv")
    if (accepted.startsWith('.')) {
      if (fileName.toLowerCase().endsWith(accepted.toLowerCase())) {
        return true;
      }
      continue;
    }
    // Exact MIME match (e.g., "application/pdf")
    if (mimeType === accepted) {
      return true;
    }
    // Wildcard MIME match (e.g., "application/*")
    if (accepted.endsWith('/*')) {
      const prefix = accepted.slice(0, -1);
      if (mimeType.startsWith(prefix)) {
        return true;
      }
    }
  }
  return false;
}
