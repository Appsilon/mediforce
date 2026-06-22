/**
 * Resolves step-level env vars from config.
 *
 * Merge order: config-level env (defaults) ← step-level env (overrides).
 * Template syntax (two equivalent forms, both resolve the same way):
 *   - `{{NAME}}` — bare key, resolved from secrets (namespace + workflow,
 *     pre-merged by the caller). No process.env fallback — all agent secrets
 *     must be configured via workspace or workflow secrets panel.
 *   - `{{SECRET:name}}` — namespaced form, resolved the same way under `name`.
 *
 * `{{OAUTH:provider}}` is reserved for OAuth token injection, which flows
 * through `HttpAuthConfig { type: 'oauth' }` and `writeMcpConfig`'s header
 * synthesis path, NOT via this resolver. Encountering it here is a config
 * error — we throw loudly rather than silently pass-through.
 *
 * Literal values (no `{{…}}` wrapper) are passed through as-is.
 */

export type EnvVarSource = 'literal' | 'namespace-secret' | 'workflow-secret' | 'auto-injected' | 'secret';

export interface ResolvedEnv {
  /** Resolved env vars to inject into the agent process */
  vars: Record<string, string>;
  /** Env var names that were injected (for audit logging — no values) */
  injectedKeys: string[];
  /** Source of each resolved env var (for visibility in run UI) */
  sources: Record<string, EnvVarSource>;
}

// Accepts `{{KEY}}` (legacy) or `{{NS:key}}` (namespaced, e.g. SECRET/OAUTH).
const TEMPLATE_REGEX = /^\{\{(?:([A-Z]+):)?([A-Za-z0-9_-]+)\}\}$/;

function parseTemplate(value: string): { namespace?: string; key: string } | null {
  const match = TEMPLATE_REGEX.exec(value);
  if (!match) return null;
  const namespace = match[1];
  const key = match[2];
  return { namespace, key };
}

export function resolveValue(value: string, workflowSecrets?: Record<string, string>): string {
  const parsed = parseTemplate(value);
  if (parsed === null) return value;
  const { namespace, key } = parsed;

  if (namespace === 'OAUTH') {
    throw new Error(
      `Template "${value}" uses the OAUTH namespace, which is not resolved at env/header-template time. ` +
        `Configure the HTTP MCP binding's auth as { type: 'oauth', provider: '${key}' } instead.`,
    );
  }

  if (workflowSecrets && key in workflowSecrets && workflowSecrets[key] !== '') {
    return workflowSecrets[key];
  }
  throw new Error(
    `Secret "${key}" is not configured. ` +
      `Add it in workspace settings (shared across workflows) or the workflow's Secrets panel.`,
  );
}

// ---------------------------------------------------------------------------
// Pre-flight validation — dry-run all {{TEMPLATE}} references without throwing
// ---------------------------------------------------------------------------

export interface MissingEnvVar {
  secretName: string;
  template: string;
  steps: Array<{ stepId: string; stepName: string }>;
}

/**
 * Validate all env var templates in a workflow definition can be resolved.
 * Returns the list of missing secrets (empty = all good).
 */
export function validateWorkflowEnv(
  definition: {
    env?: Record<string, string>;
    steps: Array<{ id: string; name: string; executor: string; env?: Record<string, string> }>;
  },
  workflowSecrets?: Record<string, string>,
): MissingEnvVar[] {
  const missingMap = new Map<string, MissingEnvVar>();

  for (const step of definition.steps) {
    if (step.executor !== 'agent' && step.executor !== 'script') continue;

    const merged = { ...definition.env, ...step.env };

    for (const [, value] of Object.entries(merged)) {
      const parsed = parseTemplate(value);
      if (parsed === null) continue;
      // OAUTH templates are handled elsewhere; treat as non-env-resolvable here.
      if (parsed.namespace === 'OAUTH') continue;

      const key = parsed.key;
      if (workflowSecrets && key in workflowSecrets && workflowSecrets[key] !== '') continue;

      if (!missingMap.has(key)) {
        missingMap.set(key, { secretName: key, template: value, steps: [] });
      }
      missingMap.get(key)!.steps.push({ stepId: step.id, stepName: step.name });
    }
  }

  return Array.from(missingMap.values());
}

// ---------------------------------------------------------------------------
// Pre-flight validation — plugin-required env vars present in step env + secrets
// ---------------------------------------------------------------------------

export interface MissingPluginEnv {
  pluginName: string;
  /** All alternative groups and which keys each group is missing. */
  groups: Array<{ keys: string[]; missing: string[] }>;
  steps: Array<{ stepId: string; stepName: string }>;
}

/**
 * Validate that every agent/script step's plugin-required env vars are
 * (a) declared in the step's merged env and (b) resolvable from secrets.
 *
 * A plugin declares `requiredEnv: string[][]` — an array of alternative
 * groups. At least one group must be fully satisfied: every key in the
 * group must appear in the step's merged env as a resolvable template.
 *
 * Keys that are absent from the step env entirely are the primary gap
 * this catches — `validateWorkflowEnv` already covers templates that
 * are present but whose secret is missing.
 */
export function validatePluginRequiredEnv(
  definition: {
    env?: Record<string, string>;
    steps: Array<{
      id: string;
      name: string;
      executor: string;
      plugin?: string;
      env?: Record<string, string>;
    }>;
  },
  pluginRequiredEnv: Map<string, string[][]>,
  workflowSecrets?: Record<string, string>,
): MissingPluginEnv[] {
  const resultMap = new Map<string, MissingPluginEnv>();

  for (const step of definition.steps) {
    if (step.executor !== 'agent' && step.executor !== 'script') continue;

    const pluginName = step.plugin ?? 'claude-code-agent';
    const groups = pluginRequiredEnv.get(pluginName);
    if (!groups || groups.length === 0) continue;

    const mergedEnv = { ...definition.env, ...step.env };

    const groupResults = groups.map((group) => {
      const missing = group.filter((key) => {
        const value = mergedEnv[key];
        if (value === undefined) {
          // Key not in env — auto-injection will add it at runtime if
          // the secret exists, so only report missing when the secret
          // is also absent.
          return !(workflowSecrets && key in workflowSecrets && workflowSecrets[key] !== '');
        }
        const parsed = parseTemplate(value);
        if (parsed === null) return false;
        if (parsed.namespace === 'OAUTH') return false;
        return !(workflowSecrets && parsed.key in workflowSecrets && workflowSecrets[parsed.key] !== '');
      });
      return { keys: group, missing };
    });

    const satisfied = groupResults.some((g) => g.missing.length === 0);
    if (satisfied) continue;

    const mapKey = `${pluginName}:${groupResults.map((g) => g.missing.sort().join(',')).join('|')}`;
    if (!resultMap.has(mapKey)) {
      resultMap.set(mapKey, { pluginName, groups: groupResults, steps: [] });
    }
    resultMap.get(mapKey)!.steps.push({ stepId: step.id, stepName: step.name });
  }

  return Array.from(resultMap.values());
}

// ---------------------------------------------------------------------------
// Pre-flight validation — model IDs exist in the registry
// ---------------------------------------------------------------------------

export interface UnknownModel {
  model: string;
  steps: Array<{ stepId: string; stepName: string }>;
}

import { normaliseModelId } from '@mediforce/platform-core';

/**
 * Validate that every agent step's model exists in the model registry.
 * `knownModelIds` should contain normalised IDs (with `/` separator).
 * The function normalises step model IDs before lookup so both `__` and
 * `/` formats match. Returns the list of unknown models (empty = all good).
 */
export function validateWorkflowModels(
  definition: {
    steps: Array<{
      id: string;
      name: string;
      executor: string;
      agent?: { model?: string };
    }>;
  },
  knownModelIds: Set<string>,
): UnknownModel[] {
  const unknownMap = new Map<string, UnknownModel>();

  for (const step of definition.steps) {
    if (step.executor !== 'agent') continue;
    const raw = step.agent?.model;
    if (!raw) continue;

    const normalised = normaliseModelId(raw);
    if (knownModelIds.has(normalised) || knownModelIds.has(raw)) continue;

    if (!unknownMap.has(normalised)) {
      unknownMap.set(normalised, { model: normalised, steps: [] });
    }
    unknownMap.get(normalised)!.steps.push({ stepId: step.id, stepName: step.name });
  }

  return Array.from(unknownMap.values());
}

// ---------------------------------------------------------------------------
// Pre-flight validation — known-but-retired models
// ---------------------------------------------------------------------------

export interface RetiredModelRef {
  model: string;
  retiredAt: string;
  steps: Array<{ stepId: string; stepName: string }>;
}

/**
 * Validate that no agent step references a retired model.
 * `retiredMap` maps normalised model ID to its ISO retirement timestamp.
 * The function normalises step model IDs (same as `validateWorkflowModels`)
 * before lookup so both `__` and `/` formats match.
 * Returns the list of retired model refs (empty = all good).
 */
export function validateRetiredModels(
  definition: {
    steps: Array<{
      id: string;
      name: string;
      executor: string;
      agent?: { model?: string };
    }>;
  },
  retiredMap: Map<string, string>,
): RetiredModelRef[] {
  const retiredRefMap = new Map<string, RetiredModelRef>();

  for (const step of definition.steps) {
    if (step.executor !== 'agent') continue;
    const raw = step.agent?.model;
    if (!raw) continue;

    const normalised = normaliseModelId(raw);
    const retiredAt = retiredMap.get(normalised) ?? retiredMap.get(raw);
    if (!retiredAt) continue;

    const key = normalised;
    if (!retiredRefMap.has(key)) {
      retiredRefMap.set(key, { model: normalised, retiredAt, steps: [] });
    }
    retiredRefMap.get(key)!.steps.push({ stepId: step.id, stepName: step.name });
  }

  return Array.from(retiredRefMap.values());
}

/**
 * Auto-inject plugin-required env vars that are absent from the merged env
 * but available in secrets. For alternative groups, picks the first group
 * whose keys are ALL available. Returns env entries to add (lowest priority).
 */
function autoInjectPluginEnv(
  merged: Record<string, string>,
  pluginRequiredEnv: string[][] | undefined,
  workflowSecrets: Record<string, string> | undefined,
): Record<string, string> {
  if (!pluginRequiredEnv || pluginRequiredEnv.length === 0) return {};

  for (const group of pluginRequiredEnv) {
    const allKeysAvailable = group.every((key) => {
      if (key in merged) return true;
      return workflowSecrets !== undefined && key in workflowSecrets && workflowSecrets[key] !== '';
    });
    if (!allKeysAvailable) continue;

    const injections: Record<string, string> = {};
    for (const key of group) {
      if (!(key in merged)) {
        injections[key] = `{{${key}}}`;
      }
    }
    return injections;
  }
  return {};
}

export function resolveStepEnv(
  configEnv: Record<string, string> | undefined,
  stepEnv: Record<string, string> | undefined,
  workflowSecrets?: Record<string, string>,
  pluginRequiredEnv?: string[][],
  namespaceSecretKeys?: ReadonlySet<string>,
): ResolvedEnv {
  const explicit = { ...configEnv, ...stepEnv };
  const autoInjected = autoInjectPluginEnv(explicit, pluginRequiredEnv, workflowSecrets);
  const merged = { ...autoInjected, ...explicit };
  const vars: Record<string, string> = {};
  const injectedKeys: string[] = [];
  const sources: Record<string, EnvVarSource> = {};

  for (const [key, value] of Object.entries(merged)) {
    vars[key] = resolveValue(value, workflowSecrets);
    injectedKeys.push(key);

    if (key in autoInjected && !(key in explicit)) {
      sources[key] = 'auto-injected';
    } else {
      const parsed = parseTemplate(value);
      if (parsed === null) {
        sources[key] = 'literal';
      } else if (namespaceSecretKeys && !namespaceSecretKeys.has(parsed.key)) {
        sources[key] = 'workflow-secret';
      } else if (namespaceSecretKeys) {
        sources[key] = 'namespace-secret';
      } else {
        sources[key] = 'secret';
      }
    }
  }

  return { vars, injectedKeys, sources };
}
