/**
 * Resolves step-level env vars from config.
 *
 * Merge order: config-level env (defaults) ← step-level env (overrides).
 * Template syntax: "{{SECRET_NAME}}" is resolved from:
 *   1. Workflow secrets (Firestore, per-namespace per-workflow)
 *   2. process.env[SECRET_NAME]
 *   3. process.env[DOCKER_SECRET_NAME]
 * Literal values are passed through as-is.
 */

export interface ResolvedEnv {
  /** Resolved env vars to inject into the agent process */
  vars: Record<string, string>;
  /** Env var names that were injected (for audit logging — no values) */
  injectedKeys: string[];
}

const TEMPLATE_REGEX = /^\{\{(\w+)\}\}$/;

export function resolveValue(value: string, workflowSecrets?: Record<string, string>): string {
  const match = TEMPLATE_REGEX.exec(value);
  if (!match) return value;

  const secretName = match[1];
  // 1. Try workflow secrets (user-provided, per-workflow)
  if (workflowSecrets && secretName in workflowSecrets && workflowSecrets[secretName] !== '') {
    return workflowSecrets[secretName];
  }
  // 2. Try the exact name from server env, then DOCKER_ prefixed version
  const resolved = process.env[secretName] || process.env[`DOCKER_${secretName}`];
  if (resolved === undefined || resolved === '') {
    throw new Error(
      `Env var template "{{${secretName}}}" references secret "${secretName}" which is not set. ` +
      `Configure it in workflow secrets or set server env "${secretName}" (or "DOCKER_${secretName}")`,
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
      const match = TEMPLATE_REGEX.exec(value);
      if (!match) continue;

      const secretName = match[1];

      // Check every resolution path (same order as resolveValue)
      if (workflowSecrets && secretName in workflowSecrets && workflowSecrets[secretName] !== '') continue;
      const resolved = process.env[secretName] || process.env[`DOCKER_${secretName}`];
      if (resolved !== undefined && resolved !== '') continue;

      if (!missingMap.has(secretName)) {
        missingMap.set(secretName, { secretName, template: `{{${secretName}}}`, steps: [] });
      }
      missingMap.get(secretName)!.steps.push({ stepId: step.id, stepName: step.name });
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
