import type { ProcessConfig, ProcessDefinition, StepConfig } from '../index.js';

export interface ConfigValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Validates that a ProcessConfig is consistent with its ProcessDefinition.
 *
 * Checks:
 * - Every step in the definition has a corresponding StepConfig entry
 * - executorType='agent' steps have a plugin specified
 * - reviewerType='agent' steps have a reviewerPlugin specified
 * - If registeredPlugins provided, all plugin/reviewerPlugin names must be in the list
 * - Warns if the same plugin is used as both executor and reviewer (self-review risk)
 */
export function validateProcessConfig(
  config: ProcessConfig,
  definition: ProcessDefinition,
  registeredPlugins?: string[],
): ConfigValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const stepConfigMap = new Map<string, StepConfig>();
  for (const sc of config.stepConfigs) {
    stepConfigMap.set(sc.stepId, sc);
  }

  // Check every definition step has a StepConfig
  for (const step of definition.steps) {
    if (!stepConfigMap.has(step.id)) {
      errors.push(`Missing StepConfig for step '${step.id}'`);
    }
  }

  // Validate each StepConfig
  for (const sc of config.stepConfigs) {
    // executorType='agent' requires a plugin
    if (sc.executorType === 'agent' && !sc.plugin) {
      errors.push(`Step '${sc.stepId}': executorType='agent' requires a 'plugin' field`);
    }

    // reviewerType='agent' requires a reviewerPlugin
    if (sc.reviewerType === 'agent' && !sc.reviewerPlugin) {
      errors.push(`Step '${sc.stepId}': reviewerType='agent' requires a 'reviewerPlugin' field`);
    }

    // Plugin registry validation
    if (registeredPlugins) {
      if (sc.plugin && !registeredPlugins.includes(sc.plugin)) {
        errors.push(`Step '${sc.stepId}': plugin '${sc.plugin}' is not a registered plugin`);
      }
      if (sc.reviewerPlugin && !registeredPlugins.includes(sc.reviewerPlugin)) {
        errors.push(`Step '${sc.stepId}': reviewerPlugin '${sc.reviewerPlugin}' is not a registered plugin`);
      }
    }

    // Self-review warning
    if (sc.plugin && sc.reviewerPlugin && sc.plugin === sc.reviewerPlugin) {
      warnings.push(`Step '${sc.stepId}': same plugin used as executor and reviewer (self-review risk)`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}
