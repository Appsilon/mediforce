/**
 * Resolves step-level env vars from config.
 *
 * Merge order: config-level env (defaults) ← step-level env (overrides).
 * Template syntax (two equivalent forms, both resolve the same way):
 *   - `{{NAME}}` — bare key, resolved from:
 *       1. Workflow secrets (Firestore, per-namespace per-workflow) under NAME
 *       2. process.env[NAME]
 *       3. process.env[DOCKER_NAME]
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

  // namespace === 'SECRET' or undefined: treat as a secret lookup
  if (workflowSecrets && key in workflowSecrets && workflowSecrets[key] !== '') {
    return workflowSecrets[key];
  }
  const resolved = process.env[key] || process.env[`DOCKER_${key}`];
  if (resolved === undefined || resolved === '') {
    throw new Error(
      `Env var template "${value}" references secret "${key}" which is not set. ` +
      `Configure it in workflow secrets or set server env "${key}" (or "DOCKER_${key}")`,
    );
  }
  return resolved;
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
      const resolved = process.env[key] || process.env[`DOCKER_${key}`];
      if (resolved !== undefined && resolved !== '') continue;

      if (!missingMap.has(key)) {
        missingMap.set(key, { secretName: key, template: value, steps: [] });
      }
      missingMap.get(key)!.steps.push({ stepId: step.id, stepName: step.name });
    }
  }

  return Array.from(missingMap.values());
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
