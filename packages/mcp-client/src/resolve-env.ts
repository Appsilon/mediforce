/**
 * Resolve {{SECRET}} template syntax in MCP server env vars.
 *
 * Resolution order:
 *   1. Workflow secrets (Firestore, per-namespace per-workflow)
 *   2. process.env[SECRET_NAME]
 *   3. process.env[DOCKER_SECRET_NAME]
 *
 * Accepted template forms (both resolve identically by the key):
 *   - `{{KEY}}` legacy bare form
 *   - `{{SECRET:key}}` namespaced form
 * `{{OAUTH:provider}}` is NOT resolved here — OAuth tokens flow through the
 * MCP transport's auth discriminant (HttpAuthConfig.type === 'oauth').
 *
 * Copied from agent-runtime/src/plugins/resolve-env.ts to keep mcp-client as
 * a lightweight leaf package with no agent-runtime dependency.
 */

const TEMPLATE_REGEX = /^\{\{(?:([A-Z]+):)?([A-Za-z0-9_-]+)\}\}$/;

export function resolveValue(value: string, workflowSecrets?: Record<string, string>): string {
  const match = TEMPLATE_REGEX.exec(value);
  if (!match) return value;
  const namespace = match[1];
  const key = match[2];

  if (namespace === 'OAUTH') {
    throw new Error(
      `Template "${value}" uses the OAUTH namespace, which is not resolved at env/header-template time. ` +
      `Configure the HTTP MCP binding's auth as { type: 'oauth', provider: '${key}' } instead.`,
    );
  }

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
