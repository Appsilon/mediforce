import type { DockerImageInfo } from '@mediforce/platform-api/contract';
import { type WorkflowDefinition, normaliseModelId, stepHasBuildSource, DOCKER_IMAGE_SETUP_URL } from '@mediforce/platform-core';

export interface PreflightAction {
  label: string;
  href: string;
}

export interface PreflightWarning {
  category:
    | 'missing-image'
    | 'missing-secret'
    | 'missing-file'
    | 'low-credits'
    | 'unknown-model'
    | 'contract-collected-twice';
  resource: string;
  stepNames: string[];
  message: string;
  actions: PreflightAction[];
}

const TEMPLATE_RE = /^\{\{(?:([A-Z]+):)?([A-Za-z0-9_-]+)\}\}$/;

export interface SecretReference {
  key: string;
  /** The step env var the key is bound to, e.g. `API_KEY: '{{MY_SECRET}}'`. */
  envVar: string;
  stepNames: string[];
}

/**
 * Every secret key a definition's container steps reference through `{{KEY}}`
 * env templates, regardless of whether it is configured. The Secrets tab
 * prepopulates rows from this; `runPreflightChecks` warns about the subset
 * that has no value.
 */
export function collectSecretReferences(definition: WorkflowDefinition): SecretReference[] {
  const references = new Map<string, SecretReference>();
  // `steps` is typed required, but a definition reaching the UI from a stale
  // bundle, a persisted react-query cache, or a partial fetch can lack it.
  // Treat a missing/non-array `steps` as empty rather than throwing
  // `definition.steps is not iterable` and taking down the whole page.
  const steps = Array.isArray(definition.steps) ? definition.steps : [];

  for (const step of steps) {
    if (step.executor !== 'agent' && step.executor !== 'script') continue;
    const env = { ...definition.env, ...step.env };
    for (const [varName, value] of Object.entries(env)) {
      const match = TEMPLATE_RE.exec(value);
      if (match === null) continue;
      const [, namespace, key] = match;
      // `{{OAUTH:provider}}` names an OAuth binding, not a secret: the runtime
      // injects that token through the MCP auth config and `resolveValue`
      // throws on the namespace, so a secret row called `provider` could never
      // satisfy the reference.
      if (namespace === 'OAUTH') continue;
      const existing = references.get(key);
      if (existing) { existing.stepNames.push(step.name); }
      else { references.set(key, { key, envVar: varName, stepNames: [step.name] }); }
    }
  }

  return [...references.values()];
}

export interface OpenRouterCreditsInfo {
  available: boolean;
  /** Real spendable budget — `min(key limit remaining, account credits)`. */
  effectiveRemaining: number;
}

const LOW_CREDITS_THRESHOLD = 0.5;
const OPENROUTER_CREDITS_URL = 'https://openrouter.ai/settings/credits';

/** Where a workflow's own files appear inside a container. A command naming a
 *  path under it is naming a file the definition is supposed to carry. */
const ARTIFACTS_MOUNT_PREFIX = '/artifacts/';

/**
 * Files a step names that the workflow does not carry.
 *
 * Two sources, both exact: a command argument under `/artifacts/`, which by
 * definition is a carried file, and a `dockerfile` with no carried file and no
 * repo to build from. `skillsDir` is deliberately not checked — with neither
 * carried skills nor an `externalSkillsRepo` it resolves against the repository
 * mounted on the host, which the browser cannot see, so a warning would fire on
 * every workflow that ships in the repo.
 */
function collectMissingFiles(
  definition: WorkflowDefinition,
  steps: WorkflowDefinition['steps'],
): Map<string, string[]> {
  const carried = new Set((definition.artifacts ?? []).map((artifact) => artifact.path));
  const missing = new Map<string, string[]>();

  const note = (path: string, stepName: string): void => {
    if (carried.has(path)) return;
    const seen = missing.get(path);
    if (seen) { if (!seen.includes(stepName)) seen.push(stepName); }
    else { missing.set(path, [stepName]); }
  };

  for (const step of steps) {
    if (step.executor !== 'agent' && step.executor !== 'script') continue;
    const config = step.executor === 'script' ? step.script : step.agent;

    const command = step.executor === 'script' ? step.script?.command : undefined;
    if (typeof command === 'string') {
      for (const token of command.split(/\s+/)) {
        if (token.startsWith(ARTIFACTS_MOUNT_PREFIX)) {
          note(token.slice(ARTIFACTS_MOUNT_PREFIX.length), step.name);
        }
      }
    }

    const dockerfile = config?.dockerfile;
    if (typeof dockerfile === 'string' && dockerfile.length > 0
      && stepHasBuildSource(config, definition.artifacts) === false) {
      note(dockerfile, step.name);
    }
  }

  return missing;
}

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
      // A step that builds its own image is not missing one — including from a
      // Dockerfile the workflow carries, which the build resolves before the
      // step's `image` is ever looked up.
      if (
        typeof image === 'string' && image.length > 0 &&
        stepHasBuildSource(containerConfig, definition.artifacts) === false
      ) {
        const [repo, tag = 'latest'] = image.split(':');
        const found = options.dockerImages.some((img) => img.repository === repo && img.tag === tag);
        if (!found) {
          const existing = imageMap.get(image);
          if (existing) { existing.push(step.name); }
          else { imageMap.set(image, [step.name]); }
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

  // `triggerInput` is the workflow's total contract and is checked before a run
  // starts, so a required field there cannot be gathered by a step later: the
  // run is refused with "Invalid payload" before anyone reaches that step. The
  // shape reads plausibly, which is why it keeps being authored.
  const entryStep = steps[0];
  const collectedTwice = (definition.triggerInput ?? [])
    .filter((field) => field.required === true)
    .filter((field) => (entryStep?.params ?? []).some((param) => param.name === field.name))
    .map((field) => field.name);
  if (collectedTwice.length > 0 && entryStep !== undefined) {
    warnings.push({
      category: 'contract-collected-twice',
      resource: collectedTwice.join(', '),
      stepNames: [entryStep.name],
      message: `The run cannot start without ${collectedTwice.join(', ')}, which '${entryStep.name}' asks for again. Either supply ${collectedTwice.length === 1 ? 'it' : 'them'} when starting the run, or make ${collectedTwice.length === 1 ? 'it' : 'them'} optional in the input contract and let the step collect ${collectedTwice.length === 1 ? 'it' : 'them'}.`,
      actions: [{
        label: 'Edit the input contract',
        href: `/${options.handle}/workflows/${encodedName}?tab=triggers`,
      }],
    });
  }

  for (const [path, stepNames] of collectMissingFiles(definition, steps)) {
    const editorHref = options.version !== undefined
      ? `/${options.handle}/workflows/${encodedName}/definitions/${String(options.version)}`
      : `/${options.handle}/workflows/${encodedName}`;
    const isDockerfile = steps.some((step) => {
      const config = step.executor === 'script' ? step.script : step.agent;
      return config?.dockerfile === path;
    });
    warnings.push({
      category: 'missing-file',
      resource: path,
      stepNames,
      message: isDockerfile
        ? `Image cannot be built: this workflow does not carry '${path}', and no repository is configured to build from`
        : `This workflow does not carry '${path}', so the step cannot read it at /artifacts/${path}`,
      actions: [{ label: 'Add the file', href: editorHref }],
    });
  }

  const configuredKeys =
    options.secretKeys || options.namespaceSecretKeys
      ? [...(options.secretKeys ?? []), ...(options.namespaceSecretKeys ?? [])]
      : null;
  const missingSecrets =
    configuredKeys === null
      ? []
      : collectSecretReferences(definition).filter((ref) => !configuredKeys.includes(ref.key));

  for (const { key, stepNames, envVar } of missingSecrets) {
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
    if (
      typeof image === 'string' && image.length > 0 &&
      stepHasBuildSource(containerConfig, definition.artifacts) === false
    ) {
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
