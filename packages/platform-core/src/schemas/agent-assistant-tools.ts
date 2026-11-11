import { z } from 'zod';
import { AgentSkillRefSchema } from './agent-definition';

/**
 * The Agent Assistant's tools: a person describes an agent they need, and the
 * assistant researches the namespace's own catalog — Agents, Skills, MCP
 * servers — before answering. Platform tools read only, run as the caller.
 * `propose_agent_match`: an existing agent already covers the need, so
 * nothing is created — the person just opens it. `propose_agent_change`: an
 * existing agent is close, so it adds one catalog Skill the agent does not
 * yet hold — accepting it goes through the same update as a person's own
 * form, which records a new Agent version (ADR-0029). `propose_new_agent`:
 * nothing in the catalog covers the need, so a new private Agent is drafted,
 * reusing every existing Skill it can and drafting at most one new one.
 * `propose_mcp_binding` names an existing catalog MCP server the agent
 * needs; accepting it submits the binding as pending — it is wired onto
 * the agent, and so actually usable, only once a namespace admin approves
 * it. `propose_requirement_matrix` is evidence, not a change:
 * it scores each candidate agent against the requirements read from the
 * person's ask, so the final proposal is not just an answer but a shown
 * comparison — nothing to accept or reject.
 */
export const AGENT_ASSISTANT_PLATFORM_TOOLS = {
  list_agents: z.object({}),
  read_agent: z.object({ id: z.string().min(1) }),
  search_skill_catalog: z.object({ query: z.string().min(1).max(200) })
    .describe('Searches Skill name and description, in this namespace and every public Skill.'),
  search_mcp_catalog: z.object({ query: z.string().min(1).max(200) })
    .describe('Searches MCP server id and description, in this namespace\'s own Tool Catalog.'),
} as const;

export type AgentAssistantPlatformToolName = keyof typeof AGENT_ASSISTANT_PLATFORM_TOOLS;

export const ProposeAgentMatchToolSchema = z.object({
  agentId: z.string().min(1),
  rationale: z.string().min(1).max(1000).describe('Why this agent already covers the need.'),
});

export const ProposeAgentChangeToolSchema = z.object({
  agentId: z.string().min(1),
  skill: AgentSkillRefSchema.describe('An existing catalog Skill, found with search_skill_catalog — never a new one.'),
  rationale: z.string().min(1).max(1000).describe('What this Skill adds and why the agent needs it.'),
});

export const ProposeMcpBindingToolSchema = z.object({
  agentId: z.string().min(1),
  serverId: z.string().min(1).describe('An existing MCP server catalogId, found with search_mcp_catalog — never invented.'),
  rationale: z.string().min(1).max(1000).describe('What this server lets the agent do and why it needs it.'),
});

const NewSkillSchema = z.object({
  id: z.string().min(1).max(64).regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'kebab-case: lowercase letters, digits and single hyphens'),
  description: z.string().min(1).max(1024),
  body: z.string().min(1).max(4000).describe('The SKILL.md body after its frontmatter: what the skill does and how.'),
});

export const ProposeNewAgentToolSchema = z.object({
  name: z.string().min(1),
  iconName: z.string().min(1),
  description: z.string().min(1),
  foundationModel: z.string().min(1),
  systemPrompt: z.string().min(1),
  inputDescription: z.string().min(1),
  outputDescription: z.string().min(1),
  skills: z.array(AgentSkillRefSchema).max(10).describe('Existing catalog Skills to reuse, found with search_skill_catalog.'),
  newSkill: NewSkillSchema.optional().describe('At most one brand-new Skill, only when no existing one covers it.'),
  rationale: z.string().min(1).max(1000).describe('Why nothing in the catalog already covers this.'),
});

const MatrixVerdictSchema = z.enum(['y', 'p', 'n']).describe('y: meets it. p: partly. n: missing.');

const MatrixCellSchema = z.object({
  verdict: MatrixVerdictSchema,
  evidence: z.string().min(1).max(300).describe('What in the agent (skill, prompt, eval result) supports this verdict.'),
});

export const ProposeRequirementMatrixToolSchema = z.object({
  requirements: z.array(z.string().min(1).max(300)).min(1).max(12)
    .describe('The need, read from the person\'s ask, broken into one checkable requirement per entry.'),
  candidates: z.array(z.object({
    agentId: z.string().min(1),
    name: z.string().min(1),
    cells: z.array(MatrixCellSchema).min(1).max(12).describe('One cell per requirement, same order.'),
  })).min(1).max(6),
}).refine(
  (value) => value.candidates.every((candidate) => candidate.cells.length === value.requirements.length),
  { message: 'each candidate needs exactly one cell per requirement, in the same order' },
);

export const AGENT_ASSISTANT_PROPOSAL_TOOLS = {
  propose_agent_match: ProposeAgentMatchToolSchema,
  propose_agent_change: ProposeAgentChangeToolSchema,
  propose_new_agent: ProposeNewAgentToolSchema,
  propose_mcp_binding: ProposeMcpBindingToolSchema,
  propose_requirement_matrix: ProposeRequirementMatrixToolSchema,
} as const;

export type AgentAssistantProposalToolName = keyof typeof AGENT_ASSISTANT_PROPOSAL_TOOLS;

export const AgentAssistantProposalSchema = z.discriminatedUnion('tool', [
  z.object({ tool: z.literal('propose_agent_match'), arguments: ProposeAgentMatchToolSchema }),
  z.object({ tool: z.literal('propose_agent_change'), arguments: ProposeAgentChangeToolSchema }),
  z.object({ tool: z.literal('propose_new_agent'), arguments: ProposeNewAgentToolSchema }),
  z.object({ tool: z.literal('propose_mcp_binding'), arguments: ProposeMcpBindingToolSchema }),
  z.object({ tool: z.literal('propose_requirement_matrix'), arguments: ProposeRequirementMatrixToolSchema }),
]);

export type AgentAssistantProposal = z.infer<typeof AgentAssistantProposalSchema>;
