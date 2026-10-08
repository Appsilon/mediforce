import type { AgentDefinition, ToolCatalogEntry } from '@mediforce/platform-core';

export type CatalogUsage = {
  agentId: string;
  agentName: string;
  bindingName: string;
  allowedTools?: string[];
};

export type SecurityLevel = 'allowlist-and-secrets' | 'allowlist' | 'secrets' | 'oauth' | 'open';

export function hasSecretTemplate(values: Record<string, string> | undefined): boolean {
  if (!values) return false;
  return Object.values(values).some((value) => value.includes('{{'));
}

/** Every agent binding that points at the given catalog entry. */
export function findCatalogUsage(agents: AgentDefinition[], catalogId: string): CatalogUsage[] {
  const usages: CatalogUsage[] = [];
  for (const agent of agents) {
    for (const [bindingName, binding] of Object.entries(agent.mcpServers ?? {})) {
      if (binding.catalogId !== catalogId) continue;
      usages.push({ agentId: agent.id, agentName: agent.name, bindingName, allowedTools: binding.allowedTools });
    }
  }
  return usages;
}

/** How guarded an entry is: whether a binding narrows its tools with an
 *  allowlist, and whether reaching it needs a secret or an OAuth token. */
export function securityLevel(entry: ToolCatalogEntry, usages: CatalogUsage[]): SecurityLevel {
  const withAllowlist = usages.some((usage) => usage.allowedTools !== undefined && usage.allowedTools.length > 0);
  const auth = entry.type === 'http' ? entry.auth : undefined;
  const secrets = entry.type === 'stdio'
    ? hasSecretTemplate(entry.env)
    : auth?.type === 'headers' && hasSecretTemplate(auth.headers);
  if (withAllowlist && secrets) return 'allowlist-and-secrets';
  if (withAllowlist) return 'allowlist';
  if (secrets) return 'secrets';
  if (auth?.type === 'oauth') return 'oauth';
  return 'open';
}
