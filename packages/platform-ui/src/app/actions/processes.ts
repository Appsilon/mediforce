'use server';

import { getPlatformServices, getAppBaseUrl } from '@/lib/platform-services';
import type { WorkflowTriggerContext } from '@mediforce/workflow-engine';
import { getWorkflowStatus } from '@/lib/workflow-status';

interface StartWorkflowRunInput {
  definitionName: string;
  definitionVersion: number;
  triggeredBy: string;
}

export async function startWorkflowRun(
  input: StartWorkflowRunInput,
): Promise<{ success: boolean; instanceId?: string; error?: string }> {
  try {
    const { manualTrigger } = getPlatformServices();

    const context: WorkflowTriggerContext = {
      definitionName: input.definitionName,
      definitionVersion: input.definitionVersion,
      triggerName: 'start',
      triggeredBy: input.triggeredBy,
      payload: {},
    };

    const result = await manualTrigger.fireWorkflow(context);

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

/** @deprecated Use startWorkflowRun instead */
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

    const result = await manualTrigger.fireWorkflow({
      definitionName: input.definitionName,
      definitionVersion: Number(input.definitionVersion),
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

export async function resumeProcessRun(
  instanceId: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    const { instanceRepo, auditRepo } = getPlatformServices();
    const instance = await instanceRepo.getById(instanceId);
    if (!instance) {
      return { success: false, error: 'Run not found' };
    }
    if (instance.status !== 'paused') {
      return { success: false, error: `Cannot resume a ${instance.status} run` };
    }
    const now = new Date().toISOString();
    await instanceRepo.update(instanceId, {
      status: 'running',
      pauseReason: null,
      error: null,
      updatedAt: now,
    });
    await auditRepo.append({
      actorId: 'user',
      actorType: 'user',
      actorRole: 'operator',
      action: 'process.resumed',
      description: `Run resumed after env configuration (was paused: ${instance.pauseReason ?? 'unknown'})`,
      timestamp: now,
      inputSnapshot: { previousPauseReason: instance.pauseReason },
      outputSnapshot: { status: 'running' },
      basis: 'User set missing env vars and resumed via UI',
      entityType: 'processInstance',
      entityId: instanceId,
      processInstanceId: instanceId,
      processDefinitionVersion: instance.definitionVersion,
    });

    // Fire-and-forget: trigger auto-runner
    const baseUrl = getAppBaseUrl();
    fetch(`${baseUrl}/api/processes/${instanceId}/run`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Api-Key': process.env.PLATFORM_API_KEY ?? '',
      },
      body: JSON.stringify({ triggeredBy: 'user' }),
    }).catch(() => {});

    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Unknown error',
    };
  }
}

export async function retryFailedStep(
  instanceId: string,
  stepId: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    const { engine } = getPlatformServices();
    await engine.retryStep(instanceId, stepId, { id: 'user', role: 'operator' });

    const baseUrl = getAppBaseUrl();
    fetch(`${baseUrl}/api/processes/${instanceId}/run`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Api-Key': process.env.PLATFORM_API_KEY ?? '',
      },
      body: JSON.stringify({ triggeredBy: 'user' }),
    }).catch(() => {});

    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Unknown error',
    };
  }
}

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
