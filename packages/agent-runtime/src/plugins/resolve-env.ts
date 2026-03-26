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

function resolveValue(value: string, workflowSecrets?: Record<string, string>): string {
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
