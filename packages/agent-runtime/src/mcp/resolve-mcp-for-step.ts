import {
  resolveEffectiveMcp,
  type AgentDefinitionRepository,
  type ResolvedMcpConfig,
  type ToolCatalogEntry,
  type ToolCatalogRepository,
  type WorkflowStep,
} from '@mediforce/platform-core';

/** Raised when a step points at an agentId that is not present in the
 *  repository. Carries the id and stepId for actionable diagnostics. */
export class AgentDefinitionNotFoundError extends Error {
  public readonly agentId: string;
  public readonly stepId: string;

  constructor(agentId: string, stepId: string) {
    super(
      `AgentDefinition '${agentId}' (referenced by step '${stepId}' via agentId) not found in the repository`,
    );
    this.name = 'AgentDefinitionNotFoundError';
    this.agentId = agentId;
    this.stepId = stepId;
  }
}

export interface ResolveMcpForStepDeps {
  agentDefinitionRepo: Pick<AgentDefinitionRepository, 'getById'>;
  toolCatalogRepo: Pick<ToolCatalogRepository, 'getById'>;
  /** Namespace used to scope toolCatalog lookups. */
  namespace: string;
}

/** Resolve the effective MCP configuration for a workflow step.
 *
 *  Contract:
 *   - step.agentId unset  → returns null (no MCP resolution runs).
 *   - step.agentId set but AgentDefinition missing → throws
 *     AgentDefinitionNotFoundError (rotten reference must surface, not
 *     silently degrade to no-MCP).
 *   - AgentDefinition has no mcpServers → returns { servers: {} }.
 *   - AgentDefinition has stdio bindings → their catalogIds are fetched
 *     from the namespace-scoped tool catalog; missing entries surface
 *     as CatalogEntryNotFoundError from resolveEffectiveMcp.
 *
 *  Only catalog entries actually referenced by the agent's stdio
 *  bindings are fetched (O(#stdio bindings), not O(#catalog)). */
export async function resolveMcpForStep(
  step: WorkflowStep,
  deps: ResolveMcpForStepDeps,
): Promise<ResolvedMcpConfig | null> {
  if (step.agentId === undefined) return null;

  const agent = await deps.agentDefinitionRepo.getById(step.agentId);
  if (agent === null) {
    throw new AgentDefinitionNotFoundError(step.agentId, step.id);
  }

  const bindings = agent.mcpServers ?? {};
  const catalogIds = new Set<string>();
  for (const binding of Object.values(bindings)) {
    if (binding.type === 'stdio') {
      catalogIds.add(binding.catalogId);
    }
  }

  const catalog = new Map<string, ToolCatalogEntry>();
  await Promise.all(
    [...catalogIds].map(async (id) => {
      const entry = await deps.toolCatalogRepo.getById(deps.namespace, id);
      if (entry !== null) catalog.set(id, entry);
    }),
  );

  return resolveEffectiveMcp(agent, step, catalog);
}
