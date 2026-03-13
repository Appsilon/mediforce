'use server';

import { getPlatformServices, getAppBaseUrl } from '@/lib/platform-services';

interface StartRunInput {
  definitionName: string;
  definitionVersion: string;
  configName: string;
  configVersion: string;
  triggeredBy: string;
}

export async function startProcessRun(
  input: StartRunInput,
): Promise<{ success: boolean; instanceId?: string; error?: string }> {
  try {
    const { manualTrigger } = getPlatformServices();

    const result = await manualTrigger.fire({
      definitionName: input.definitionName,
      definitionVersion: input.definitionVersion,
      configName: input.configName,
      configVersion: input.configVersion,
      triggerName: 'start',
      triggeredBy: input.triggeredBy,
      payload: {},
    });

    // Fire-and-forget: trigger auto-runner asynchronously
    const baseUrl = getAppBaseUrl();
    fetch(`${baseUrl}/api/processes/${result.instanceId}/run`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Api-Key': process.env.PLATFORM_API_KEY ?? '',
      },
      body: JSON.stringify({
        appContext: {},
        triggeredBy: input.triggeredBy,
      }),
    }).catch((err) => {
      console.error(`[auto-runner] Failed to trigger run for ${result.instanceId}:`, err);
    });

    return { success: true, instanceId: result.instanceId };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Unknown error',
    };
  }
}

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
