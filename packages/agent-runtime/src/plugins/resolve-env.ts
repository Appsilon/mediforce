/**
 * Resolves step-level env vars from config.
 *
 * Merge order: config-level env (defaults) ← step-level env (overrides).
 * Template syntax: "{{SECRET_NAME}}" is resolved from process.env.
 * Literal values are passed through as-is.
 */

export interface ResolvedEnv {
  /** Resolved env vars to inject into the agent process */
  vars: Record<string, string>;
  /** Env var names that were injected (for audit logging — no values) */
  injectedKeys: string[];
}

const TEMPLATE_REGEX = /^\{\{(\w+)\}\}$/;

function resolveValue(value: string): string {
  const match = TEMPLATE_REGEX.exec(value);
  if (!match) return value;

  const secretName = match[1];
  // Try the exact name first, then fall back to DOCKER_ prefixed version
  const resolved = process.env[secretName] || process.env[`DOCKER_${secretName}`];
  if (resolved === undefined || resolved === '') {
    throw new Error(
      `Env var template "{{${secretName}}}" references server secret "${secretName}" (or "DOCKER_${secretName}") which is not set`,
    );
  }
  return resolved;
}

export function resolveStepEnv(
  configEnv: Record<string, string> | undefined,
  stepEnv: Record<string, string> | undefined,
): ResolvedEnv {
  const merged = { ...configEnv, ...stepEnv };
  const vars: Record<string, string> = {};
  const injectedKeys: string[] = [];

  for (const [key, value] of Object.entries(merged)) {
    vars[key] = resolveValue(value);
    injectedKeys.push(key);
  }

  return { vars, injectedKeys };
}
