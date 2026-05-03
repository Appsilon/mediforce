import type { DockerImageInfo } from '@mediforce/platform-api/contract';
import type { WorkflowDefinition } from '@mediforce/platform-core';

export interface PreflightWarning {
  category: 'missing-image' | 'missing-secret';
  stepId: string;
  stepName: string;
  message: string;
}

const TEMPLATE_RE = /^\{\{(?:[A-Z]+:)?([A-Za-z0-9_-]+)\}\}$/;

export function runPreflightChecks(
  definition: WorkflowDefinition,
  options: {
    dockerImages?: DockerImageInfo[];
    dockerAvailable: boolean;
    secretKeys?: string[];
  },
): PreflightWarning[] {
  const warnings: PreflightWarning[] = [];

  for (const step of definition.steps) {
    if (step.executor !== 'agent' && step.executor !== 'script') continue;

    if (options.dockerAvailable && options.dockerImages) {
      const image = step.agent?.image;
      if (typeof image === 'string' && image.length > 0) {
        const [repo, tag = 'latest'] = image.split(':');
        const found = options.dockerImages.some((img) => img.repository === repo && img.tag === tag);
        if (!found) {
          warnings.push({
            category: 'missing-image',
            stepId: step.id,
            stepName: step.name,
            message: `Image '${image}' not found on platform`,
          });
        }
      }
    }

    if (options.secretKeys) {
      const env = { ...definition.env, ...step.env };
      for (const [varName, value] of Object.entries(env)) {
        const match = TEMPLATE_RE.exec(value);
        if (match === null) continue;
        const key = match[1];
        if (!options.secretKeys.includes(key)) {
          warnings.push({
            category: 'missing-secret',
            stepId: step.id,
            stepName: step.name,
            message: `Secret '${key}' not configured (used in ${varName})`,
          });
        }
      }
    }
  }

  return warnings;
}
