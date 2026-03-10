'use server';

import { getPlatformServices } from '@/lib/platform-services';

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
  try {
    const { humanTaskRepo, instanceRepo, auditRepo, engine } =
      getPlatformServices();

    const task = await humanTaskRepo.getById(taskId);
    if (!task) {
      return { success: false, error: 'Task not found' };
    }

    if (task.status !== 'claimed') {
      return {
        success: false,
        error: `Cannot complete a ${task.status} task — must be claimed first`,
      };
    }

    const now = new Date().toISOString();
    const completionData = {
      files: files.map((file) => ({
        name: file.name,
        size: file.size,
        type: file.type,
        storagePath: file.storagePath ?? null,
        downloadUrl: file.downloadUrl ?? null,
        uploadedAt: now,
      })),
      completedBy: task.assignedUserId,
      completedAt: now,
    };

    await humanTaskRepo.complete(taskId, completionData);

    await auditRepo.append({
      actorId: task.assignedUserId ?? 'user',
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
      processInstanceId: task.processInstanceId,
    });

    // Resume the paused process instance
    const instance = await instanceRepo.getById(task.processInstanceId);
    if (!instance) {
      return { success: false, error: `Process instance '${task.processInstanceId}' not found` };
    }

    if (instance.status === 'paused') {
      await instanceRepo.update(task.processInstanceId, {
        status: 'running',
        pauseReason: null,
        updatedAt: now,
      });

      await engine.advanceStep(
        task.processInstanceId,
        { files: completionData.files, taskId },
        { id: task.assignedUserId ?? 'user', role: 'human' },
      );
    }

    // Fire-and-forget: trigger auto-runner
    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:9003';
    fetch(`${appUrl}/api/processes/${task.processInstanceId}/run`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Api-Key': process.env.PLATFORM_API_KEY ?? '',
      },
      body: JSON.stringify({ triggeredBy: task.assignedUserId ?? 'user' }),
    }).catch(() => {});

    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Unknown error',
    };
  }
}
