import type { z } from 'zod';
import {
  DEFAULT_MODEL,
  AGENT_ASSISTANT_PLATFORM_TOOLS,
  AGENT_ASSISTANT_PROPOSAL_TOOLS,
  ProposeAgentMatchToolSchema,
  ProposeAgentChangeToolSchema,
  ProposeMcpBindingToolSchema,
  ProposeNewAgentToolSchema,
  ProposeRequirementMatrixToolSchema,
  type AgentAssistantPlatformToolName,
  type AgentDefinition,
} from '@mediforce/platform-core';
import { AgentAssistantProposalViewSchema, type AskAgentAssistantInput, type AskAgentAssistantOutput, type AgentAssistantProgress, type AgentProposalEvidence } from '../../contract/agent-assistant';
import type { CallerScope } from '../../repositories/index';
import { assertNamespaceAccess } from '../../auth';
import { recordAssistantPrompt, runProposalToolLoop, type ProposalReview } from '../../assistant-core';
import { requireOpenRouterApiKey } from '../../services/openrouter-key';
import { listAgentValidations } from '../evaluation/step-qualification';
import { findStepsUsingAgent } from '../evaluation/_lib/agent-production-runs';

const MAX_TOOL_LOOP_ITERATIONS = 12;
const ASSISTANT_MAX_OUTPUT_TOKENS = 4000;
const MAX_CATALOG_MATCHES = 20;

const SYSTEM_PROMPT = 'You help a person find, extend or design a Mediforce Agent for their workspace\'s'
  + ' catalog. Call list_agents before answering, so you recommend from what actually exists rather'
  + ' than guessing. Use read_agent for an agent\'s full system prompt and tools, and'
  + ' search_skill_catalog / search_mcp_catalog to check whether a capability the person needs'
  + ' already exists before proposing something new. If an existing agent already covers the'
  + ' need, call propose_agent_match with its id — do not propose a new agent for something'
  + ' the catalog already does. If an agent is close but is missing one catalog Skill you found'
  + ' with search_skill_catalog, call propose_agent_change to add it — never invent a new Skill here.'
  + ' Only when nothing in the catalog is close, call propose_new_agent: reuse every existing Skill'
  + ' you found, and draft at most one brand-new Skill for what truly does not exist yet. If the'
  + ' person\'s ask names a real integration or tool and search_mcp_catalog finds it, call'
  + ' propose_mcp_binding with its id on the matched, changed or new agent — never invent a server id.'
  + ' It is wired onto the agent only once a namespace admin approves it; say that plainly. Before your'
  + ' final proposal, if you read more than one real candidate agent, call propose_requirement_matrix'
  + ' once: break the person\'s ask into requirements and score every candidate you actually read against each one,'
  + ' with the evidence for every cell. Skip it when only one agent was ever in consideration.'
  + ' Never name a specific agent as your answer in plain text alone — naming one means you have'
  + ' decided it fits (or is close, or that none do), and that decision always goes through one of'
  + ' propose_agent_match, propose_agent_change or propose_new_agent in the same turn, even when you'
  + ' are not fully certain. Plain text without a proposal call gives the person nothing to act on;'
  + ' explain your reasoning in the text, but let the proposal carry the actual recommendation.';

/** Real evidence for a match or change proposal, never the model's own claim — null namespace (a platform-global agent) carries none. */
async function agentEvidence(scope: CallerScope, agent: AgentDefinition): Promise<AgentProposalEvidence | undefined> {
  if (agent.namespace === undefined) return undefined;
  const [{ statuses }, usages] = await Promise.all([
    listAgentValidations({ namespace: agent.namespace }, scope),
    findStepsUsingAgent(scope, { kind: 'agent', namespace: agent.namespace, agentId: agent.id }),
  ]);
  return {
    qualification: statuses[agent.id] ?? null,
    usedIn: usages.map((usage) => `${usage.workflowName} (step ${usage.stepId})`),
  };
}

async function reviewAgentProposal(toolName: string, args: unknown, scope: CallerScope, namespace: string): Promise<ProposalReview> {
  if (toolName === 'propose_requirement_matrix') {
    const { candidates } = args as z.infer<typeof ProposeRequirementMatrixToolSchema>;
    for (const candidate of candidates) {
      if ((await scope.agentDefinitions.getById(candidate.agentId)) === null) {
        return { ok: false, error: `No agent with id '${candidate.agentId}' is visible to you. Use an id from list_agents.` };
      }
    }
    return { ok: true };
  }
  if (toolName === 'propose_new_agent') {
    const { skills, newSkill } = args as z.infer<typeof ProposeNewAgentToolSchema>;
    for (const ref of skills) {
      if ((await scope.skills.getById(ref.namespace, ref.id)) === null) {
        return { ok: false, error: `No Skill '${ref.namespace}/${ref.id}' is visible to you. Use search_skill_catalog.` };
      }
    }
    if (newSkill !== undefined && (await scope.skills.getById(namespace, newSkill.id)) !== null) {
      return { ok: false, error: `Skill '${namespace}/${newSkill.id}' already exists; put it in skills instead of newSkill.` };
    }
    return { ok: true };
  }
  const { agentId } = args as z.infer<typeof ProposeAgentMatchToolSchema>;
  const agent = await scope.agentDefinitions.getById(agentId);
  if (agent === null) return { ok: false, error: `No agent with id '${agentId}' is visible to you. Use an id from list_agents.` };
  if (toolName === 'propose_agent_change') {
    const { skill } = args as z.infer<typeof ProposeAgentChangeToolSchema>;
    const found = await scope.skills.getById(skill.namespace, skill.id);
    if (found === null) return { ok: false, error: `No Skill '${skill.namespace}/${skill.id}' is visible to you. Use search_skill_catalog.` };
    if ((agent.skills ?? []).some((ref) => ref.namespace === skill.namespace && ref.id === skill.id)) {
      return { ok: false, error: `Agent '${agent.name}' already holds Skill '${skill.namespace}/${skill.id}'.` };
    }
  }
  if (toolName === 'propose_mcp_binding') {
    const { serverId } = args as z.infer<typeof ProposeMcpBindingToolSchema>;
    if ((await scope.toolCatalog.getById(namespace, serverId)) === null) {
      return { ok: false, error: `No MCP server '${serverId}' is visible to you. Use search_mcp_catalog.` };
    }
  }
  const evidence = await agentEvidence(scope, agent);
  return evidence === undefined ? { ok: true } : { ok: true, evidence };
}

/** True when every word of `query` appears somewhere in `haystack` — so "pdf extraction" still finds "Extract text from PDF", which a single-substring check would miss. */
function matchesQuery(haystack: string, query: string): boolean {
  const text = haystack.toLowerCase();
  return query.toLowerCase().split(/\s+/).filter((word) => word.length > 0).every((word) => text.includes(word));
}

function agentSummary(agent: AgentDefinition) {
  return {
    id: agent.id,
    name: agent.name,
    description: agent.description,
    foundationModel: agent.foundationModel,
    skills: (agent.skills ?? []).map((ref) => `${ref.namespace}/${ref.id}`),
    mcpServers: Object.keys(agent.mcpServers ?? {}),
  };
}

/** One turn with the namespace's Agent Assistant. Read-only: it can only research the catalog so far. */
export async function askAgentAssistant(
  input: AskAgentAssistantInput,
  scope: CallerScope,
  onProgress?: (event: AgentAssistantProgress) => void,
): Promise<AskAgentAssistantOutput> {
  assertNamespaceAccess(scope.caller, input.namespace);
  const apiKey = await requireOpenRouterApiKey(scope, input.namespace);
  const model = input.model ?? DEFAULT_MODEL;

  await recordAssistantPrompt(scope, {
    namespace: input.namespace,
    model,
    messages: input.messages,
    action: 'agent_assistant.prompt',
    description: `Agent Assistant prompt in ${input.namespace} (model: ${model})`,
    basis: 'Agent Assistant request',
    entityType: 'agent_assistant',
    entityId: input.namespace,
    logTag: 'agent-assistant',
  });

  const executePlatformTool = async (toolName: AgentAssistantPlatformToolName, args: unknown): Promise<unknown> => {
    if (toolName === 'list_agents') {
      const agents = await scope.agentDefinitions.list(input.namespace);
      return agents.map(agentSummary);
    }
    if (toolName === 'read_agent') {
      const { id } = args as z.infer<typeof AGENT_ASSISTANT_PLATFORM_TOOLS.read_agent>;
      const agent = await scope.agentDefinitions.getById(id);
      if (agent === null) return { error: `No agent with id '${id}' is visible to you.` };
      return {
        ...agentSummary(agent),
        visibility: agent.visibility,
        systemPrompt: agent.systemPrompt,
        inputDescription: agent.inputDescription,
        outputDescription: agent.outputDescription,
      };
    }
    if (toolName === 'search_skill_catalog') {
      const { query } = args as z.infer<typeof AGENT_ASSISTANT_PLATFORM_TOOLS.search_skill_catalog>;
      const [ownSkills, publicSkills] = await Promise.all([
        scope.skills.list(input.namespace),
        scope.skills.listPublic(),
      ]);
      const seen = new Set<string>();
      const matches = [...ownSkills, ...publicSkills].filter((skill) => {
        const key = `${skill.namespace}/${skill.id}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return matchesQuery(`${skill.name} ${skill.description}`, query);
      });
      return matches.slice(0, MAX_CATALOG_MATCHES).map((skill) => ({
        namespace: skill.namespace,
        id: skill.id,
        name: skill.name,
        description: skill.description,
        visibility: skill.visibility,
      }));
    }
    // search_mcp_catalog
    const { query } = args as z.infer<typeof AGENT_ASSISTANT_PLATFORM_TOOLS.search_mcp_catalog>;
    const entries = await scope.toolCatalog.list(input.namespace);
    const matches = entries.filter((entry) => matchesQuery(`${entry.id} ${entry.description ?? ''}`, query));
    return matches.slice(0, MAX_CATALOG_MATCHES).map((entry) => ({
      id: entry.id,
      type: entry.type,
      description: entry.description,
    }));
  };

  const result = await runProposalToolLoop({
    model,
    apiKey,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      ...input.messages.map((message) => ({ role: message.role, content: message.content })),
    ],
    proposalTools: AGENT_ASSISTANT_PROPOSAL_TOOLS,
    platformTools: AGENT_ASSISTANT_PLATFORM_TOOLS,
    executePlatformTool,
    reviewProposal: (toolName, args) => reviewAgentProposal(toolName, args, scope, input.namespace),
    maxIterations: MAX_TOOL_LOOP_ITERATIONS,
    maxTokens: ASSISTANT_MAX_OUTPUT_TOKENS,
    onProgress,
  });

  return {
    reply: result.reply,
    proposals: result.proposals.map(({ tool, arguments: proposed, evidence }) =>
      AgentAssistantProposalViewSchema.parse({ tool, arguments: proposed, ...(evidence === undefined ? {} : { evidence }) })),
  };
}
