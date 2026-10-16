import { z } from 'zod';
import { AgentMcpBindingMapSchema } from './agent-mcp-binding';
import { AgentOutputSchemaSchema } from './agent-output-schema';
import type { AgentDefinition } from './agent-definition';
import { OfferedSkillSchema } from './step-execution';
import type { WorkflowDefinition, WorkflowStep } from './workflow-definition';

/**
 * Everything about an Agent that shapes what it does (ADR-0029): its runtime,
 * model, system prompt, output schema, MCP bindings and the Skills it is
 * offered, each by content hash. Its name, icon, descriptions and visibility
 * are left out, so renaming an Agent does not make it a new version. An Agent
 * with no output schema has none in its snapshot, so its hash is the one it
 * had before Agents could declare one.
 */
export const AgentConfigSnapshotSchema = z.object({
  kind: z.enum(['plugin', 'cowork']),
  runtimeId: z.string().nullable(),
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
 * any run. It is never stored as a Workflow; each trial carries it on its run.
 */
export function agentEvalDefinition(
  agent: Pick<AgentDefinition, 'id' | 'name'> & { namespace: string; runtimeId: string },
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
      agent: {},
      ...(Object.keys(env).length === 0 ? {} : { env }),
    }],
    transitions: [],
  };
}

/** A part of an Agent that a Workflow Step running it changes. */
export type AgentStepChange =
  | 'plugin'
  | 'model'
  | 'step prompt'
  | 'skills'
  | 'output schema'
  | 'MCP servers'
  | 'MCP restrictions'
  | 'workflow preamble';

/**
 * What a Workflow Step changes about the Agent it runs, compared with the
 * trial of `agentEvalDefinition` its validation was read from: another
 * runtime or model, a prompt, Skills, output schema or MCP servers of its own,
 * an MCP restriction that removes something, or a workflow preamble. Empty
 * when the step runs the Agent as it was validated. What the step provides
 * around the Agent — image, params, env, timeout, autonomy, review — is not
 * a change: an Agent names no image.
 */
export function agentStepChanges(
  step: Pick<WorkflowStep, 'plugin' | 'agent' | 'mcpRestrictions'>,
  agent: Pick<AgentDefinition, 'runtimeId' | 'foundationModel'>,
  preamble?: string,
): AgentStepChange[] {
  const config = step.agent ?? {};
  const restricted = Object.values(step.mcpRestrictions ?? {})
    .some((entry) => entry.disable === true || (entry.denyTools?.length ?? 0) > 0);
  const changed: Record<AgentStepChange, boolean> = {
    plugin: step.plugin !== undefined && step.plugin !== agent.runtimeId,
    model: config.model !== undefined && config.model !== agent.foundationModel,
    'step prompt': config.prompt !== undefined && config.prompt.trim() !== '',
    skills: (config.skills?.length ?? 0) > 0,
    'output schema': config.outputSchema !== undefined,
    'MCP servers': (config.mcpServers?.length ?? 0) > 0,
    'MCP restrictions': restricted,
    'workflow preamble': preamble !== undefined && preamble.trim() !== '',
  };
  return (Object.keys(changed) as AgentStepChange[]).filter((change) => changed[change]);
}
