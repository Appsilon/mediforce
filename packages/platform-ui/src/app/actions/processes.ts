'use server';

import { getPlatformServices } from '@/lib/platform-services';
import { getWorkflowStatus } from '@/lib/workflow-status';

export async function archiveProcessRun(
  instanceId: string,
  archived: boolean,
): Promise<{ success: boolean; error?: string }> {
  try {
    const { instanceRepo, auditRepo } = getPlatformServices();
    const instance = await instanceRepo.getById(instanceId);
    if (!instance) {
      return { success: false, error: 'Run not found' };
    }
    const { displayStatus } = getWorkflowStatus(instance);
    if (displayStatus === 'in_progress' || displayStatus === 'waiting_for_human') {
      return { success: false, error: 'Cannot archive an active run' };
    }
    const now = new Date().toISOString();
    await instanceRepo.update(instanceId, { archived, updatedAt: now });
    await auditRepo.append({
      actorId: 'user',
      actorType: 'user',
      actorRole: 'operator',
      action: archived ? 'instance.archived' : 'instance.unarchived',
      description: `Run ${archived ? 'archived' : 'unarchived'} by operator`,
      timestamp: now,
      inputSnapshot: { previousArchived: instance.archived ?? false },
      outputSnapshot: { archived },
      basis: 'User-initiated archive via UI',
      entityType: 'processInstance',
      entityId: instanceId,
      processInstanceId: instanceId,
      processDefinitionVersion: instance.definitionVersion,
    });
    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Unknown error',
    };
  }
}

export interface BulkOperationResult {
  succeeded: string[];
  failed: Array<{ id: string; error: string }>;
}

const BULK_LIMIT = 100;

export async function bulkCancelProcessRuns(
  instanceIds: string[],
): Promise<BulkOperationResult> {
  if (instanceIds.length > BULK_LIMIT) {
    return { succeeded: [], failed: [{ id: '', error: `Bulk limit exceeded (max ${BULK_LIMIT})` }] };
  }
  try {
    const { instanceRepo, auditRepo } = getPlatformServices();
    const now = new Date().toISOString();
    const succeeded: string[] = [];
    const failed: Array<{ id: string; error: string }> = [];

    const instances = await Promise.all(
      instanceIds.map((id) => instanceRepo.getById(id)),
    );

    await Promise.all(
      instances.map(async (instance, index) => {
        const id = instanceIds[index];
        if (!instance) {
          failed.push({ id, error: 'Run not found' });
          return;
        }
        if (instance.status !== 'running' && instance.status !== 'paused') {
          failed.push({ id, error: `Cannot cancel a ${instance.status} run` });
          return;
        }
        await Promise.all([
          instanceRepo.update(id, {
            status: 'failed',
            error: 'Cancelled by user',
            updatedAt: now,
          }),
          auditRepo.append({
            actorId: 'user',
            actorType: 'user',
            actorRole: 'operator',
            action: 'instance.cancelled',
            description: `Run cancelled by operator (was ${instance.status}${instance.currentStepId ? ` at step '${instance.currentStepId}'` : ''})`,
            timestamp: now,
            inputSnapshot: { previousStatus: instance.status, currentStepId: instance.currentStepId },
            outputSnapshot: { status: 'failed', error: 'Cancelled by user' },
            basis: 'User-initiated bulk cancel via UI',
            entityType: 'processInstance',
            entityId: id,
            processInstanceId: id,
            processDefinitionVersion: instance.definitionVersion,
          }),
        ]);
        succeeded.push(id);
      }),
    );

    return { succeeded, failed };
  } catch (err) {
    return {
      succeeded: [],
      failed: [{ id: '', error: err instanceof Error ? err.message : 'Unknown error' }],
    };
  }
}

export async function bulkArchiveProcessRuns(
  instanceIds: string[],
): Promise<BulkOperationResult> {
  if (instanceIds.length > BULK_LIMIT) {
    return { succeeded: [], failed: [{ id: '', error: `Bulk limit exceeded (max ${BULK_LIMIT})` }] };
  }
  try {
    const { instanceRepo, auditRepo } = getPlatformServices();
    const now = new Date().toISOString();
    const succeeded: string[] = [];
    const failed: Array<{ id: string; error: string }> = [];

    const instances = await Promise.all(
      instanceIds.map((id) => instanceRepo.getById(id)),
    );

    await Promise.all(
      instances.map(async (instance, index) => {
        const id = instanceIds[index];
        if (!instance) {
          failed.push({ id, error: 'Run not found' });
          return;
        }
        const { displayStatus } = getWorkflowStatus(instance);
        if (displayStatus === 'in_progress' || displayStatus === 'waiting_for_human') {
          failed.push({ id, error: 'Cannot archive an active run' });
          return;
        }
        await Promise.all([
          instanceRepo.update(id, { archived: true, updatedAt: now }),
          auditRepo.append({
            actorId: 'user',
            actorType: 'user',
            actorRole: 'operator',
            action: 'instance.archived',
            description: 'Run archived by operator',
            timestamp: now,
            inputSnapshot: { previousArchived: instance.archived ?? false },
            outputSnapshot: { archived: true },
            basis: 'User-initiated bulk archive via UI',
            entityType: 'processInstance',
            entityId: id,
            processInstanceId: id,
            processDefinitionVersion: instance.definitionVersion,
          }),
        ]);
        succeeded.push(id);
      }),
    );

    return { succeeded, failed };
  } catch (err) {
    return {
      succeeded: [],
      failed: [{ id: '', error: err instanceof Error ? err.message : 'Unknown error' }],
    };
  }
}

