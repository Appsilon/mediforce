import type { SpawnActionConfig, SpawnTargetConfig, ProcessRepository } from '@mediforce/platform-core';
import type { ManualTrigger } from '@mediforce/workflow-engine';
import { interpolate } from '../interpolation.js';
import type { SpawnActionHandler, InterpolationSources } from '../types.js';

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
}

export function createSpawnActionHandler(
  manualTrigger: ManualTrigger,
  processRepo: ProcessRepository,
): SpawnActionHandler {
  return async (config, ctx) => {
    const spawned: SpawnActionOutput['spawned'] = [];
    const errors: SpawnActionOutput['errors'] = [];

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
        const version = target.definitionVersion
          ?? await processRepo.getLatestWorkflowVersion(ctx.namespace, target.definitionName);

        if (version === 0) {
          throw new Error(
            `workflow definition '${target.definitionName}' not found in namespace '${ctx.namespace}'`,
          );
        }

        const result = await manualTrigger.fireWorkflow({
          namespace: ctx.namespace,
          definitionName: target.definitionName,
          definitionVersion: version,
          triggerName: target.triggerName ?? 'manual',
          triggeredBy: `spawn:${ctx.processInstanceId}`,
          payload: interpolatedPayload,
        });

        spawned.push({
          instanceId: result.instanceId,
          definitionName: target.definitionName,
          definitionVersion: version,
          status: 'created',
          ...(itemIndex !== undefined ? { itemIndex } : {}),
        });
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

function resolveTargets(
  config: SpawnActionConfig,
  sources: InterpolationSources,
): ExpandedTarget[] {
  if (config.forEach) {
    const resolved = interpolate(config.forEach, sources);
    if (!Array.isArray(resolved)) {
      throw new Error(
        `forEach resolved to ${typeof resolved}, expected array`,
      );
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
