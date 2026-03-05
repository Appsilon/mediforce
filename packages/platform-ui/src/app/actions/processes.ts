'use server';

import { getPlatformServices } from '@/lib/platform-services';

export async function cancelProcessRun(
  instanceId: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    const { instanceRepo, auditRepo } = getPlatformServices();
    const instance = await instanceRepo.getById(instanceId);
    if (!instance) {
      return { success: false, error: 'Run not found' };
    }
    if (instance.status !== 'running' && instance.status !== 'paused') {
      return { success: false, error: `Cannot cancel a ${instance.status} run` };
    }
    const now = new Date().toISOString();
    await instanceRepo.update(instanceId, {
      status: 'failed',
      error: 'Cancelled by user',
      updatedAt: now,
    });
    await auditRepo.append({
      actorId: 'user',
      actorType: 'user',
      actorRole: 'operator',
      action: 'instance.cancelled',
      description: `Run cancelled by operator (was ${instance.status}${instance.currentStepId ? ` at step '${instance.currentStepId}'` : ''})`,
      timestamp: now,
      inputSnapshot: { previousStatus: instance.status, currentStepId: instance.currentStepId },
      outputSnapshot: { status: 'failed', error: 'Cancelled by user' },
      basis: 'User-initiated cancel via UI — double-confirm pattern',
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
