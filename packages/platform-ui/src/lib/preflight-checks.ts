import type { DockerImageInfo } from '@mediforce/platform-api/contract';
import { type WorkflowDefinition, normaliseModelId, DOCKER_IMAGE_SETUP_URL } from '@mediforce/platform-core';

export interface PreflightAction {
  label: string;
  href: string;
}

export interface PreflightWarning {
  category: 'missing-image' | 'missing-secret' | 'low-credits' | 'unknown-model';
  resource: string;
  stepNames: string[];
  message: string;
  actions: PreflightAction[];
}

const TEMPLATE_RE = /^\{\{(?:[A-Z]+:)?([A-Za-z0-9_-]+)\}\}$/;

export interface OpenRouterCreditsInfo {
  available: boolean;
  /** Real spendable budget — `min(key limit remaining, account credits)`. */
  effectiveRemaining: number;
}

const LOW_CREDITS_THRESHOLD = 0.5;
const OPENROUTER_CREDITS_URL = 'https://openrouter.ai/settings/credits';

export function runPreflightChecks(
  definition: WorkflowDefinition,
  options: {
    dockerImages?: DockerImageInfo[];
    dockerAvailable: boolean;
    secretKeys?: string[];
    namespaceSecretKeys?: string[];
    openRouterCredits?: OpenRouterCreditsInfo;
    handle: string;
    workflowName: string;
    version?: number;
    adminEmail?: string;
    modelValidation?: { unknown: Array<{ id: string; suggestion: string | null }> };
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
  const encodedName = encodeURIComponent(options.workflowName);

  for (const [image, stepNames] of imageMap) {
    const actions: PreflightAction[] = [
      {
        label: 'Configure build source',
        href: options.version !== undefined
          ? `/${options.handle}/workflows/${encodedName}/definitions/${options.version}`
          : `/${options.handle}/workflows/${encodedName}`,
      },
      {
        label: 'Build manually',
        href: DOCKER_IMAGE_SETUP_URL,
      },
    ];
    if (typeof options.adminEmail === 'string' && options.adminEmail.length > 0) {
      actions.push({ label: 'Contact admin', href: `mailto:${options.adminEmail}` });
    }
    warnings.push({
      category: 'missing-image',
      resource: image,
      stepNames,
      message: `Image '${image}' not found on platform`,
      actions,
    });
  }

  for (const [key, { stepNames, envVar }] of secretMap) {
    warnings.push({
      category: 'missing-secret',
      resource: key,
      stepNames,
      message: `Secret '${key}' not configured (referenced as ${envVar})`,
      actions: [
        {
          label: 'Configure in Secrets panel',
          href: `/${options.handle}/workflows/${encodedName}?tab=secrets&setup=${encodeURIComponent(key)}`,
        },
      ],
    });
  }

  if (options.openRouterCredits?.available && options.openRouterCredits.effectiveRemaining <= LOW_CREDITS_THRESHOLD) {
    const agentSteps = steps
      .filter((s) => s.executor === 'agent')
      .map((s) => s.name);
    if (agentSteps.length > 0) {
      const remaining = options.openRouterCredits.effectiveRemaining;
      warnings.push({
        category: 'low-credits',
        resource: 'OPENROUTER_API_KEY',
        stepNames: agentSteps,
        message: remaining <= 0
          ? 'OpenRouter credits exhausted ($0.00 remaining)'
          : `OpenRouter credits low ($${remaining.toFixed(2)} remaining)`,
        actions: [
          { label: 'Top up credits', href: OPENROUTER_CREDITS_URL },
        ],
      });
    }
  }

  if (options.modelValidation) {
    const modelStepMap = new Map<string, string[]>();
    for (const step of steps) {
      if (step.executor !== 'agent') continue;
      const raw = step.agent?.model;
      if (typeof raw === 'string' && raw.length > 0) {
        const normalised = normaliseModelId(raw);
        const existing = modelStepMap.get(normalised);
        if (existing) { existing.push(step.name); }
        else { modelStepMap.set(normalised, [step.name]); }
      }
    }
    for (const entry of options.modelValidation.unknown) {
      const stepNames = modelStepMap.get(entry.id) ?? [];
      if (stepNames.length === 0) continue;
      const suggestion = entry.suggestion;
      const message = suggestion
        ? `Model '${entry.id}' not found in registry — did you mean '${suggestion}'?`
        : `Model '${entry.id}' not found in registry`;
      warnings.push({
        category: 'unknown-model',
        resource: entry.id,
        stepNames,
        message,
        actions: [
          {
            label: 'Edit workflow',
            href: options.version !== undefined
              ? `/${options.handle}/workflows/${encodedName}/definitions/${options.version}`
              : `/${options.handle}/workflows/${encodedName}`,
          },
        ],
      });
    }
  }

  return warnings;
}

/** A readiness check that was relevant to the definition but did not run. */
export type SkippedCheck = 'images' | 'credits' | 'models';

/**
 * Which readiness checks could not run against this definition. An empty
 * warning list means "all present" only when this returns nothing — a probe
 * that failed produces no warnings either, and reporting that as a pass tells
 * the user a check succeeded when it was skipped.
 */
export function findSkippedChecks(
  definition: WorkflowDefinition,
  options: {
    /** False when the image registry is unreachable or not configured. */
    dockerAvailable: boolean;
    /** True when the credits probe itself failed (not merely unconfigured). */
    creditsFailed: boolean;
    /** True when the model registry lookup errored. */
    modelValidationFailed: boolean;
  },
): SkippedCheck[] {
  const steps = Array.isArray(definition.steps) ? definition.steps : [];

  let needsImageLookup = false;
  let hasAgentStep = false;
  let namesModel = false;

  for (const step of steps) {
    if (step.executor !== 'agent' && step.executor !== 'script') continue;
    const containerConfig = step.executor === 'script' ? step.script : step.agent;

    const image = containerConfig?.image;
    const hasBuildSource = typeof containerConfig?.repo === 'string' && containerConfig.repo.length > 0
      && typeof containerConfig?.commit === 'string' && containerConfig.commit.length > 0;
    if (typeof image === 'string' && image.length > 0 && !hasBuildSource) {
      needsImageLookup = true;
    }

    if (step.executor === 'agent') {
      hasAgentStep = true;
      const model = step.agent?.model;
      if (typeof model === 'string' && model.length > 0) namesModel = true;
    }
  }

  const skipped: SkippedCheck[] = [];
  if (needsImageLookup && !options.dockerAvailable) skipped.push('images');
  if (hasAgentStep && options.creditsFailed) skipped.push('credits');
  if (namesModel && options.modelValidationFailed) skipped.push('models');
  return skipped;
}
