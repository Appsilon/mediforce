'use server';

import { getPlatformServices } from '@/lib/platform-services';
import { executeAgentStep } from '@/lib/execute-agent-step';

interface FileInfo {
  name: string;
  size: number;
  type: string;
  storagePath?: string;
  downloadUrl?: string;
}

export async function completeUploadTask(
  taskId: string,
  files: FileInfo[],
): Promise<{ success: boolean; error?: string }> {
  const { humanTaskRepo, instanceRepo, auditRepo, engine } =
    getPlatformServices();

  // ── 1. Validate task ──────────────────────────────────────────────────
  const task = await humanTaskRepo.getById(taskId);
  if (!task) {
    console.error(`[upload-task] Task not found: ${taskId}`);
    return { success: false, error: 'Task not found' };
  }

  if (task.status !== 'claimed') {
    console.error(`[upload-task] Task ${taskId} is ${task.status}, expected claimed`);
    return { success: false, error: `Cannot complete a ${task.status} task — must be claimed first` };
  }

  const processInstanceId = task.processInstanceId;
  const triggeredBy = task.assignedUserId ?? 'user';
  const now = new Date().toISOString();

  // ── 2. Complete the task ──────────────────────────────────────────────
  const completionData = {
    files: files.map((file) => ({
      name: file.name,
      size: file.size,
      type: file.type,
      storagePath: file.storagePath ?? null,
      downloadUrl: file.downloadUrl ?? null,
      uploadedAt: now,
    })),
    completedBy: triggeredBy,
    completedAt: now,
  };

  try {
    await humanTaskRepo.complete(taskId, completionData);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error(`[upload-task] Failed to complete task ${taskId}:`, message);
    return { success: false, error: `Failed to complete task: ${message}` };
  }

  await auditRepo.append({
    actorId: triggeredBy,
    actorType: 'user',
    actorRole: 'operator',
    action: 'task.completed',
    description: `Upload task '${taskId}' completed with ${files.length} file(s) for step '${task.stepId}'`,
    timestamp: now,
    inputSnapshot: { taskId, fileCount: files.length, stepId: task.stepId },
    outputSnapshot: { status: 'completed', completionData },
    basis: 'User uploaded files via UI',
    entityType: 'humanTask',
    entityId: taskId,
    processInstanceId,
  });

  // ── 3. Resume paused process ──────────────────────────────────────────
  const instance = await instanceRepo.getById(processInstanceId);
  if (!instance) {
    console.error(`[upload-task] Instance not found: ${processInstanceId}`);
    return { success: false, error: `Process instance '${processInstanceId}' not found` };
  }

  const appContext = { files: completionData.files };

  if (instance.status === 'paused') {
    try {
      await instanceRepo.update(processInstanceId, {
        status: 'running',
        pauseReason: null,
        updatedAt: now,
      });

      await engine.advanceStep(
        processInstanceId,
        appContext,
        { id: triggeredBy, role: 'human' },
      );
      console.log(`[upload-task] Advanced process ${processInstanceId} past '${task.stepId}'`);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      console.error(`[upload-task] Failed to advance process ${processInstanceId}:`, message);

      // Mark instance as failed so it's visible in the UI
      await instanceRepo.update(processInstanceId, {
        status: 'failed',
        error: `Upload task completed but process advance failed: ${message}`,
        updatedAt: new Date().toISOString(),
      }).catch(() => {});

      return { success: false, error: `Process advance failed: ${message}` };
    }
  }

  // ── 4. Trigger agent step if next step is an agent ────────────────────
  const updatedInstance = await instanceRepo.getById(processInstanceId);
  const nextStepId = updatedInstance?.currentStepId;

  if (updatedInstance?.status === 'running' && nextStepId) {
    const { processRepo } = getPlatformServices();
    const processConfig = await processRepo.getProcessConfig(
      updatedInstance.definitionName,
      updatedInstance.configName,
      updatedInstance.configVersion,
    );
    const stepConfig = processConfig?.stepConfigs.find(
      (sc) => sc.stepId === nextStepId,
    );

    if (stepConfig?.executorType === 'agent') {
      console.log(`[upload-task] Scheduling agent step '${nextStepId}' for ${processInstanceId}`);
      setTimeout(() => {
        executeAgentStep(processInstanceId, nextStepId, appContext, triggeredBy)
          .then(() => {
            console.log(`[upload-task] Agent step '${nextStepId}' completed for ${processInstanceId}`);
          })
          .catch(async (err) => {
            const message = err instanceof Error ? err.message : 'Unknown error';
            console.error(`[upload-task] Agent step '${nextStepId}' failed for ${processInstanceId}:`, message);

            // Mark instance as failed
            await instanceRepo.update(processInstanceId, {
              status: 'failed',
              error: `Agent step '${nextStepId}' failed: ${message}`,
              updatedAt: new Date().toISOString(),
            }).catch(() => {});
          });
      }, 0);
    }
  }

  return { success: true };
}
