import { z } from 'zod';
import { AgentMcpBindingMapSchema } from './agent-mcp-binding';
import { AgentOutputSchemaSchema } from './agent-output-schema';
import { agentImageOf, type AgentDefinition } from './agent-definition';
import { normalizeImageRef } from '../utils/image-reference';
import { stepHasBuildSource } from '../workflows/build-source';
import { OfferedSkillSchema } from './step-execution';
import type { WorkflowDefinition, WorkflowStep } from './workflow-definition';

/**
 * Everything about an Agent that shapes what it does (ADR-0029): its runtime,
 * image, model, system prompt, output schema, MCP bindings and the Skills it
 * is offered, each by content hash. Its name, icon, descriptions and
 * visibility are left out, so renaming an Agent does not make it a new
 * version. An Agent with no output schema or image has none in its snapshot,
 * so its hash is the one it had before Agents could declare them.
 */
export const AgentConfigSnapshotSchema = z.object({
  kind: z.enum(['plugin', 'cowork']),
  runtimeId: z.string().nullable(),
  image: z.string().optional(),
  foundationModel: z.string(),
  systemPrompt: z.string(),
  outputSchema: AgentOutputSchemaSchema.optional(),
  mcpServers: AgentMcpBindingMapSchema,
  skills: z.array(OfferedSkillSchema),
});

/**
 * One immutable version of an Agent (ADR-0029): a configuration it had, with
 * the SHA-256 of that configuration. A new version is recorded whenever the
 * Agent is saved or evaluated with a configuration whose hash differs from its
 * newest version's, so the version an Eval Run names is exactly what it ran.
 */
export const AgentVersionSchema = z.object({
  agentId: z.string().min(1),
  version: z.number().int().positive(),
  hash: z.string().regex(/^[0-9a-f]{64}$/),
  config: AgentConfigSnapshotSchema,
  createdBy: z.string().min(1),
  createdAt: z.iso.datetime(),
});

export type AgentConfigSnapshot = z.infer<typeof AgentConfigSnapshotSchema>;
export type AgentVersion = z.infer<typeof AgentVersionSchema>;

/** The id of the one Step an Agent's Eval Run trial runs (ADR-0029). */
export const AGENT_EVAL_STEP_ID = 'agent';

/**
 * The single-step Workflow Definition an Agent's eval trial runs (ADR-0029):
 * one agent Step that names the Agent and adds nothing to it — no prompt,
 * model, Skills or MCP restrictions of its own, and no preamble. The one thing
 * it may add is `env` — the step env a Workflow Step would declare, such as
 * `{{OPENROUTER_API_KEY}}` templates — so the trial resolves its secrets like
 * any run. It runs in the Agent's image, so the trial has the tools the Agent
 * is meant to have. It is never stored as a Workflow; each trial carries it on
 * its run.
 */
export function agentEvalDefinition(
  agent: Pick<AgentDefinition, 'id' | 'name' | 'image'> & { namespace: string; runtimeId: string },
  agentVersion: number,
  env: Record<string, string> = {},
): WorkflowDefinition {
  return {
    name: `agent:${agent.id}`,
    version: agentVersion,
    namespace: agent.namespace,
    visibility: 'private',
    title: agent.name,
    steps: [{
      id: AGENT_EVAL_STEP_ID,
      name: agent.name,
      type: 'creation',
      executor: 'agent',
      plugin: agent.runtimeId,
      agentId: agent.id,
      agent: { image: agentImageOf(agent) },
      ...(Object.keys(env).length === 0 ? {} : { env }),
    }],
    transitions: [],
  };
}

/** A part of an Agent that a Workflow Step running it changes. */
export type AgentStepChange =
  | 'plugin'
  | 'model'
  | 'image'
  | 'step prompt'
  | 'skills'
  | 'output schema'
  | 'MCP servers'
  | 'MCP restrictions'
  | 'workflow preamble';

/**
 * What a Workflow Step changes about the Agent it runs, compared with the
 * trial of `agentEvalDefinition` its validation was read from: another
 * runtime, model or image, a prompt, Skills, output schema or MCP servers of
 * its own, an MCP restriction that removes something, or a workflow preamble.
 * Empty when the step runs the Agent as it was validated. A step that names no
 * image runs the Agent's; one that builds its own image (`stepHasBuildSource`,
 * which needs the Definition's `artifacts`) changes it, since the
 * image decides which tools the Agent has. What the step provides around the
 * Agent — params, env, timeout, autonomy, review — is not a change.
 */
export function agentStepChanges(
  step: Pick<WorkflowStep, 'plugin' | 'agent' | 'mcpRestrictions'>,
  agent: Pick<AgentDefinition, 'runtimeId' | 'foundationModel' | 'image'>,
  definition: Pick<WorkflowDefinition, 'preamble' | 'artifacts'> = {},
): AgentStepChange[] {
  const { preamble } = definition;
  const config = step.agent ?? {};
  const restricted = Object.values(step.mcpRestrictions ?? {})
    .some((entry) => entry.disable === true || (entry.denyTools?.length ?? 0) > 0);
  const changed: Record<AgentStepChange, boolean> = {
    plugin: step.plugin !== undefined && step.plugin !== agent.runtimeId,
    model: config.model !== undefined && config.model !== agent.foundationModel,
    image: stepHasBuildSource(config, definition)
      || (config.image !== undefined && config.image !== '' && normalizeImageRef(config.image) !== normalizeImageRef(agentImageOf(agent))),
    'step prompt': config.prompt !== undefined && config.prompt.trim() !== '',
    skills: (config.skills?.length ?? 0) > 0,
    'output schema': config.outputSchema !== undefined,
    'MCP servers': (config.mcpServers?.length ?? 0) > 0,
    'MCP restrictions': restricted,
    'workflow preamble': preamble !== undefined && preamble.trim() !== '',
  };
  return (Object.keys(changed) as AgentStepChange[]).filter((change) => changed[change]);
}

