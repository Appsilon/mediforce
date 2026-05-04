import type { DockerImageInfo } from '@mediforce/platform-api/contract';
import type { WorkflowDefinition } from '@mediforce/platform-core';

export interface PreflightWarning {
  category: 'missing-image' | 'missing-secret';
  resource: string;
  stepNames: string[];
  message: string;
  hint: string;
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
  const imageMap = new Map<string, string[]>();
  const secretMap = new Map<string, { stepNames: string[]; envVar: string }>();

  for (const step of definition.steps) {
    if (step.executor !== 'agent' && step.executor !== 'script') continue;

    if (options.dockerAvailable && options.dockerImages) {
      const image = step.agent?.image;
      const hasBuildSource = typeof step.agent?.repo === 'string' && step.agent.repo.length > 0
        && typeof step.agent?.commit === 'string' && step.agent.commit.length > 0;
      if (typeof image === 'string' && image.length > 0 && !hasBuildSource) {
        const [repo, tag = 'latest'] = image.split(':');
        const found = options.dockerImages.some((img) => img.repository === repo && img.tag === tag);
        if (!found) {
          const existing = imageMap.get(image);
          if (existing) { existing.push(step.name); }
          else { imageMap.set(image, [step.name]); }
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
          const existing = secretMap.get(key);
          if (existing) { existing.stepNames.push(step.name); }
          else { secretMap.set(key, { stepNames: [step.name], envVar: varName }); }
        }
      }
    }
  }

  const warnings: PreflightWarning[] = [];

  for (const [image, stepNames] of imageMap) {
    warnings.push({
      category: 'missing-image',
      resource: image,
      stepNames,
      message: `Image '${image}' not found on platform`,
      hint: 'Configure a build source (repo + commit) on this step, or contact your admin.',
    });
  }

  for (const [key, { stepNames, envVar }] of secretMap) {
    warnings.push({
      category: 'missing-secret',
      resource: key,
      stepNames,
      message: `Secret '${key}' not configured (referenced as ${envVar})`,
      hint: 'Add this secret in the Secrets panel for this workflow.',
    });
  }

  return warnings;
}
