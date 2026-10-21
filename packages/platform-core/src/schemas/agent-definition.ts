// TODO: rename AgentDefinition* → Agent* (schema, type, file). Canonical
// glossary entry is `Agent` (CONTEXT.md); its versions are `AgentVersion`
// (ADR-0029), so the "Definition" suffix is a historical artifact. See
// CONTEXT.md "Agent vs Agent Definition" flagged ambiguity.
import { z } from 'zod';
import { AgentMcpBindingMapSchema } from './agent-mcp-binding';
import { AgentOutputSchemaSchema } from './agent-output-schema';
import type { Skill } from './skill';
import { DEFAULT_AGENT_IMAGE } from '../utils/container-defaults';
import { normalizeImageRef } from '../utils/image-reference';

export const AgentVisibilitySchema = z.enum(['public', 'private']);
export type AgentVisibility = z.infer<typeof AgentVisibilitySchema>;

/** A Skill an Agent holds, named in the Namespace it lives in (ADR-0025
 *  decision 4): a private Agent may hold another workspace's public Skill,
 *  and two workspaces may each have a Skill with the same id. */
export const AgentSkillRefSchema = z.object({
  namespace: z.string().min(1),
  id: z.string().min(1),
});
export type AgentSkillRef = z.infer<typeof AgentSkillRefSchema>;

/** An Agent's Skills become sibling folders in one plugin directory, so their
 *  ids must be distinct even when their namespaces differ. */
export const AgentSkillRefsSchema = z.array(AgentSkillRefSchema).superRefine((refs, ctx) => {
  const seen = new Set<string>();
  refs.forEach((ref, index) => {
    if (seen.has(ref.id)) {
      ctx.addIssue({
        code: 'custom',
        path: [index, 'id'],
        message: `skill id '${ref.id}' is listed more than once; an agent's skills need distinct ids`,
      });
    }
    seen.add(ref.id);
  });
});

export const AgentDefinitionSchema = z.object({
  id: z.string(),
  /** Discriminates runtime dispatch. 'plugin' routes to PluginRegistry
   *  (container agent). 'cowork' routes to the cowork session runtime
   *  (chat/voice widget with human-in-the-loop). */
  kind: z.enum(['plugin', 'cowork']).default('plugin'),
  /** Runtime implementation identifier. For kind='plugin' this is a
   *  PluginRegistry key (e.g. 'claude-code-agent'). For kind='cowork'
   *  this is a cowork runtime key (e.g. 'chat', 'voice-realtime'). */
  runtimeId: z.string().optional(),
  /** Image tag a container agent runs in — its tools come from it. Unset
   *  means the golden image (`agentImageOf`). A Step that names no image of
   *  its own is given this one when its Workflow is saved. */
  image: z.string().trim().min(1).optional(),
  name: z.string().min(1),
  iconName: z.string(),
  description: z.string(),
  foundationModel: z.string(),
  systemPrompt: z.string(),
  inputDescription: z.string(),
  outputDescription: z.string(),
  /** The JSON Schema the agent's `result` must satisfy, wherever it runs: shown
   *  in its prompt and checked after the run (one reshape, then escalation). A
   *  Step's own `agent.outputSchema` replaces it. */
  outputSchema: AgentOutputSchemaSchema.optional(),
  /** Canonical MCP server configuration for this agent. Map of server
   *  name → AgentMcpBinding. Step-level restrictions can only narrow
   *  (disable servers or deny tools) — they cannot broaden. */
  mcpServers: AgentMcpBindingMapSchema.optional(),
  /** Catalog Skills this agent is offered at run time (ADR-0025). */
  skills: AgentSkillRefsSchema.optional(),
  namespace: z.string().min(1).optional(),
  visibility: AgentVisibilitySchema.default('private'),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type AgentDefinition = z.infer<typeof AgentDefinitionSchema>;

/** ADR-0025 decision 3, ADR-0027 decision 4: a private Skill is held only by
 *  a private Agent, or added only by a Step of a private Workflow, of its own
 *  Namespace; a public Skill by every one. */
export interface SkillHolder {
  namespace?: string;
  visibility: 'public' | 'private';
}

export function mayHoldSkill(
  holder: SkillHolder,
  skill: Pick<Skill, 'namespace' | 'visibility'>,
): boolean {
  if (skill.visibility === 'public') return true;
  return holder.visibility === 'private' && holder.namespace === skill.namespace;
}

export const CreateAgentDefinitionInputSchema = AgentDefinitionSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

/** A patch. `.partial()` keeps each field's `.default()`, which would reset an
 *  omitted `kind` or `visibility` on every update, so those two drop it. An
 *  omitted `outputSchema` or `image` is kept and `null` removes it. */
export const UpdateAgentDefinitionInputSchema = CreateAgentDefinitionInputSchema.partial().extend({
  kind: AgentDefinitionSchema.shape.kind.unwrap().optional(),
  visibility: AgentVisibilitySchema.optional(),
  outputSchema: AgentOutputSchemaSchema.nullable().optional(),
  image: AgentDefinitionSchema.shape.image.unwrap().nullable().optional(),
});

export type CreateAgentDefinitionInput = z.infer<typeof CreateAgentDefinitionInputSchema>;
export type UpdateAgentDefinitionInput = z.infer<typeof UpdateAgentDefinitionInputSchema>;

/** The Agent with a patch applied, before the repository stamps and parses it. */
export function mergeAgentUpdate(current: AgentDefinition, patch: UpdateAgentDefinitionInput): AgentDefinition {
  const { outputSchema, image, ...rest } = patch;
  const merged: AgentDefinition = { ...current, ...rest };
  if (outputSchema === null) delete merged.outputSchema;
  if (outputSchema !== undefined && outputSchema !== null) merged.outputSchema = outputSchema;
  if (image === null) delete merged.image;
  if (image !== undefined && image !== null) merged.image = image;
  return merged;
}

/** The Agent's own image, or undefined when it names none or names the golden
 *  one — picking golden explicitly is the same Agent, not a new version. */
export function ownAgentImage(agent: Pick<AgentDefinition, 'image'>): string | undefined {
  if (agent.image === undefined) return undefined;
  return normalizeImageRef(agent.image) === normalizeImageRef(DEFAULT_AGENT_IMAGE) ? undefined : agent.image;
}

/** The image an Agent runs in: its own, or the golden image when it names none. */
export function agentImageOf(agent: Pick<AgentDefinition, 'image'>): string {
  return agent.image ?? DEFAULT_AGENT_IMAGE;
}
