/**
 * Resolve {{SECRET}} template syntax in MCP server env vars.
 *
 * Resolution order:
 *   1. Workflow secrets (Firestore, per-namespace per-workflow)
 *   2. process.env[SECRET_NAME]
 *   3. process.env[DOCKER_SECRET_NAME]
 *
 * Copied from agent-runtime/src/plugins/resolve-env.ts to keep
 * mcp-client as a lightweight leaf package with no agent-runtime dependency.
 */

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
