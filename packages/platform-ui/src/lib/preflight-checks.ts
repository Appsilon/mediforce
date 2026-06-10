import type { DockerImageInfo } from '@mediforce/platform-api/contract';
import type { WorkflowDefinition } from '@mediforce/platform-core';

export interface PreflightWarning {
  category: 'missing-image' | 'missing-secret' | 'low-credits';
  resource: string;
  stepNames: string[];
  message: string;
  hint: string;
}

const TEMPLATE_RE = /^\{\{(?:[A-Z]+:)?([A-Za-z0-9_-]+)\}\}$/;

export interface OpenRouterCreditsInfo {
  available: boolean;
  remaining: number;
}

const LOW_CREDITS_THRESHOLD = 0.5;

export function runPreflightChecks(
  definition: WorkflowDefinition,
  options: {
    dockerImages?: DockerImageInfo[];
    dockerAvailable: boolean;
    secretKeys?: string[];
    namespaceSecretKeys?: string[];
    openRouterCredits?: OpenRouterCreditsInfo;
  },
): PreflightWarning[] {
  const imageMap = new Map<string, string[]>();
  const secretMap = new Map<string, { stepNames: string[]; envVar: string }>();

  // `steps` is typed required, but a definition reaching the UI from a stale
  // bundle, a persisted react-query cache, or a partial fetch can lack it.
  // Treat a missing/non-array `steps` as empty rather than throwing
  // `definition.steps is not iterable` and taking down the whole page.
  const steps = Array.isArray(definition.steps) ? definition.steps : [];

  for (const step of steps) {
    if (step.executor !== 'agent' && step.executor !== 'script') continue;

    const containerConfig = step.executor === 'script' ? step.script : step.agent;

    if (options.dockerAvailable && options.dockerImages) {
      const image = containerConfig?.image;
      const hasBuildSource = typeof containerConfig?.repo === 'string' && containerConfig.repo.length > 0
        && typeof containerConfig?.commit === 'string' && containerConfig.commit.length > 0;
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

    if (options.secretKeys || options.namespaceSecretKeys) {
      const allKeys = [
        ...(options.secretKeys ?? []),
        ...(options.namespaceSecretKeys ?? []),
      ];
      const env = { ...definition.env, ...step.env };
      for (const [varName, value] of Object.entries(env)) {
        const match = TEMPLATE_RE.exec(value);
        if (match === null) continue;
        const key = match[1];
        if (!allKeys.includes(key)) {
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
      hint: 'Add this secret in workspace settings (shared) or the workflow Secrets panel (per-workflow).',
    });
  }

  if (options.openRouterCredits?.available && options.openRouterCredits.remaining <= LOW_CREDITS_THRESHOLD) {
    const agentSteps = steps
      .filter((s) => s.executor === 'agent')
      .map((s) => s.name);
    if (agentSteps.length > 0) {
      const remaining = options.openRouterCredits.remaining;
      warnings.push({
        category: 'low-credits',
        resource: 'OPENROUTER_API_KEY',
        stepNames: agentSteps,
        message: remaining <= 0
          ? 'OpenRouter credits exhausted ($0.00 remaining)'
          : `OpenRouter credits low ($${remaining.toFixed(2)} remaining)`,
        hint: 'Top up credits at https://openrouter.ai/settings/credits or the run will fail.',
      });
    }
  }

  return warnings;
}
