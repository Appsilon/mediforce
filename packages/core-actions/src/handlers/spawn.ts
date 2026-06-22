import type { SpawnActionConfig, SpawnTargetConfig, ProcessRepository } from '@mediforce/platform-core';
import { interpolate } from '../interpolation';
import type { SpawnActionHandler, InterpolationSources } from '../types';

interface TriggerResult {
  instanceId: string;
  status: string;
}

interface WorkflowTrigger {
  fireWorkflow(context: {
    namespace: string;
    definitionName: string;
    definitionVersion: number;
    triggerName: string;
    triggeredBy: string;
    payload?: Record<string, unknown>;
    parentInstanceId?: string;
    parentDefinitionName?: string;
    dryRun?: boolean;
  }): Promise<TriggerResult>;
}

const MAX_SPAWNS_PER_STEP = 50;

export interface SpawnActionOutput {
  spawned: Array<{
    instanceId: string;
    definitionName: string;
    definitionVersion: number;
    status: 'created';
    itemIndex?: number;
  }>;
  errors: Array<{
    definitionName: string;
    itemIndex?: number;
    message: string;
  }>;
  spawnedCount: number;
  errorCount: number;
  [key: string]: unknown;
}

interface RunKicker {
  kick(instanceId: string, opts?: { readonly triggeredBy?: string }): Promise<void>;
}

export function createSpawnActionHandler(
  manualTrigger: WorkflowTrigger,
  processRepo: Pick<ProcessRepository, 'getLatestWorkflowVersion'>,
  runKicker?: RunKicker,
): SpawnActionHandler {
  return async (config, ctx) => {
    const spawned: SpawnActionOutput['spawned'] = [];
    const errors: SpawnActionOutput['errors'] = [];

    if (!ctx.namespace) {
      throw new Error('spawn action requires namespace in ActionContext');
    }
    const namespace = ctx.namespace;

    const expandedTargets = resolveTargets(config, ctx.sources);

    if (expandedTargets.length > MAX_SPAWNS_PER_STEP) {
      throw new Error(
        `spawn fan-out exceeds maximum of ${MAX_SPAWNS_PER_STEP} children per step execution (got ${expandedTargets.length})`,
      );
    }

    for (const { target, itemIndex, item } of expandedTargets) {
      const sources: InterpolationSources = {
        ...ctx.sources,
        ...(item !== undefined ? { item } : {}),
      };
      const interpolatedPayload = target.payload
        ? (interpolate(target.payload, sources) as Record<string, unknown>)
        : {};

      try {
        const version =
          target.definitionVersion ?? (await processRepo.getLatestWorkflowVersion(namespace, target.definitionName));

        if (version === 0) {
          throw new Error(`workflow definition '${target.definitionName}' not found in namespace '${namespace}'`);
        }

        const result = await manualTrigger.fireWorkflow({
          namespace: namespace,
          definitionName: target.definitionName,
          definitionVersion: version,
          triggerName: target.triggerName ?? 'manual',
          triggeredBy: 'spawn',
          payload: interpolatedPayload,
          parentInstanceId: ctx.processInstanceId,
          parentDefinitionName: ctx.definitionName,
          ...(ctx.dryRun ? { dryRun: true } : {}),
        });

        spawned.push({
          instanceId: result.instanceId,
          definitionName: target.definitionName,
          definitionVersion: version,
          status: 'created',
          ...(itemIndex !== undefined ? { itemIndex } : {}),
        });

        if (runKicker) {
          await runKicker.kick(result.instanceId, {
            triggeredBy: 'spawn',
          });
        }
      } catch (err) {
        if (config.continueOnSpawnError === false) {
          throw err;
        }
        errors.push({
          definitionName: target.definitionName,
          ...(itemIndex !== undefined ? { itemIndex } : {}),
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }

    const output: SpawnActionOutput = {
      spawned,
      errors,
      spawnedCount: spawned.length,
      errorCount: errors.length,
    };
    return output;
  };
}

interface ExpandedTarget {
  target: SpawnTargetConfig;
  itemIndex?: number;
  item?: unknown;
}

function resolveTargets(config: SpawnActionConfig, sources: InterpolationSources): ExpandedTarget[] {
  if (config.forEach) {
    const resolved = interpolate(config.forEach, sources);
    if (!Array.isArray(resolved)) {
      throw new Error(`forEach resolved to ${typeof resolved}, expected array`);
    }
    const template = Array.isArray(config.targets) ? config.targets[0] : config.targets;
    return resolved.map((item, index) => ({
      target: template,
      itemIndex: index,
      item,
    }));
  }

  const targets = Array.isArray(config.targets) ? config.targets : [config.targets];
  return targets.map((target) => ({ target }));
}
