import type {
  AgentDefinition,
  ToolCatalogEntry,
  ToolCatalogRepository,
} from '@mediforce/platform-core';
import type { CallerIdentity } from '../auth';
import { AuthorizedScope } from './authorized-repository';

/**
 * Workspace-scoped view of `ToolCatalogRepository`. The underlying store is
 * organised as `namespaces/{handle}/toolCatalog/*`, so the namespace is a
 * required argument on every method; the wrapper asserts membership before
 * delegating.
 */
export class AuthorizedToolCatalogRepository extends AuthorizedScope {
  constructor(
    caller: CallerIdentity,
    private readonly raw: ToolCatalogRepository,
  ) {
    super(caller);
  }

  /** `boundBy` is the agent being resolved, already read through the caller's
   *  scope. A public agent runs with its own workspace's servers wherever it
   *  is used, so the entries it binds there are readable to any caller who
   *  can see the agent. */
  getById = async (
    namespace: string,
    entryId: string,
    boundBy?: Pick<AgentDefinition, 'namespace' | 'visibility' | 'mcpServers'>,
  ): Promise<ToolCatalogEntry | null> => {
    if (!this.canSeeNamespace(namespace) && !publicAgentBinds(boundBy, namespace, entryId)) return null;
    return this.raw.getById(namespace, entryId);
  };

  list = async (namespace: string): Promise<ToolCatalogEntry[]> => {
    if (!this.canSeeNamespace(namespace)) return [];
    return this.raw.list(namespace);
  };

  upsert = async (namespace: string, entry: ToolCatalogEntry): Promise<ToolCatalogEntry> => {
    this.assertNamespaceWrite(namespace);
    return this.raw.upsert(namespace, entry);
  };

  delete = async (namespace: string, entryId: string): Promise<void> => {
    this.assertNamespaceWrite(namespace);
    await this.raw.delete(namespace, entryId);
  };
}

function publicAgentBinds(
  agent: Pick<AgentDefinition, 'namespace' | 'visibility' | 'mcpServers'> | undefined,
  namespace: string,
  entryId: string,
): boolean {
  if (agent === undefined || agent.visibility !== 'public' || agent.namespace !== namespace) return false;
  return Object.values(agent.mcpServers ?? {}).some((binding) => binding.catalogId === entryId);
}
