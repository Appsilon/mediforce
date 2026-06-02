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

export interface ResolvedEnv {
  /** Resolved env vars to inject into the agent process */
  vars: Record<string, string>;
  /** Env var names that were injected (for audit logging — no values) */
  injectedKeys: string[];
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
// Pre-flight validation — model IDs exist in the registry
// ---------------------------------------------------------------------------

export interface UnknownModel {
  model: string;
  steps: Array<{ stepId: string; stepName: string }>;
}

/** Normalise Firestore-encoded model IDs ("a__b" → "a/b"). */
function normaliseModelId(raw: string): string {
  if (raw.includes('/')) return raw;
  const idx = raw.indexOf('__');
  return idx < 0 ? raw : `${raw.slice(0, idx)}/${raw.slice(idx + 2)}`;
}

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

export function resolveStepEnv(
  configEnv: Record<string, string> | undefined,
  stepEnv: Record<string, string> | undefined,
  workflowSecrets?: Record<string, string>,
): ResolvedEnv {
  const merged = { ...configEnv, ...stepEnv };
  const vars: Record<string, string> = {};
  const injectedKeys: string[] = [];

  for (const [key, value] of Object.entries(merged)) {
    vars[key] = resolveValue(value, workflowSecrets);
    injectedKeys.push(key);
  }

  return { vars, injectedKeys };
}
