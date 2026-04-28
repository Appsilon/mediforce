import type { AgentDefinition } from '@mediforce/platform-core';

export type HttpBindingAuthKind = 'none' | 'headers' | 'oauth';

export type HttpBindingRow = {
  key: string;
  name: string;
  url: string;
  agentId: string;
  agentName: string;
  allowedTools?: string[];
  hasSecretHeaders: boolean;
  authKind: HttpBindingAuthKind;
  oauthProvider?: string;
};

export function hasSecretTemplate(values: Record<string, string> | undefined): boolean {
  if (!values) return false;
  return Object.values(values).some((value) => value.includes('{{'));
}

/**
 * Flatten every HTTP MCP binding across the given agents into rows keyed by
 * `<agentId>::<bindingName>`. Stdio bindings are ignored — they live in the
 * namespace-scoped catalog, not per agent.
 */
export function collectHttpBindings(agents: AgentDefinition[]): HttpBindingRow[] {
  const rows: HttpBindingRow[] = [];
  for (const agent of agents) {
    const bindings = agent.mcpServers ?? {};
    for (const [name, binding] of Object.entries(bindings)) {
      if (binding.type !== 'http') continue;
      const auth = binding.auth;
      const authKind: HttpBindingAuthKind = auth?.type ?? 'none';
      const hasSecretHeaders = auth?.type === 'headers' ? hasSecretTemplate(auth.headers) : false;
      const oauthProvider = auth?.type === 'oauth' ? auth.provider : undefined;
      rows.push({
        key: `${agent.id}::${name}`,
        name,
        url: binding.url,
        agentId: agent.id,
        agentName: agent.name,
        allowedTools: binding.allowedTools,
        hasSecretHeaders,
        authKind,
        oauthProvider,
      });
    }
  }
  return rows;
}

/**
 * Count how many agent bindings reference the given stdio catalog entry, and
 * whether any of those bindings narrow the tool surface with an allowlist.
 */
export function countStdioUsage(
  agents: AgentDefinition[],
  catalogId: string,
): { total: number; withAllowlist: boolean } {
  let total = 0;
  let withAllowlist = false;
  for (const agent of agents) {
    const bindings = agent.mcpServers ?? {};
    for (const binding of Object.values(bindings)) {
      if (binding.type === 'stdio' && binding.catalogId === catalogId) {
        total += 1;
        if (binding.allowedTools && binding.allowedTools.length > 0) withAllowlist = true;
      }
    }
  }
  return { total, withAllowlist };
}
