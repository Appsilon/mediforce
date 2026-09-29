import type { StepMcpRestriction } from '../schemas/agent-mcp-binding';
import type { McpEvalServerPolicy } from '../schemas/evaluation';
import type { WorkflowStep } from '../schemas/workflow-definition';

/** `base` narrowed by `extra`: a server either disables stays disabled, and denied tools add up. */
export function narrowMcpRestrictions(base: StepMcpRestriction = {}, extra: StepMcpRestriction = {}): StepMcpRestriction {
  const merged: StepMcpRestriction = { ...base };
  for (const [name, restriction] of Object.entries(extra)) {
    const existing = merged[name] ?? {};
    const denyTools = [...new Set([...(existing.denyTools ?? []), ...(restriction.denyTools ?? [])])];
    merged[name] = {
      ...((existing.disable === true || restriction.disable === true) ? { disable: true } : {}),
      ...(denyTools.length === 0 ? {} : { denyTools }),
    };
  }
  return merged;
}

/**
 * The step restrictions an eval trial runs with (D6): the step's own
 * `mcpRestrictions` narrowed by, for every server the step's agent binds, the
 * eval policy — `deny` (or no entry at all) disables the server, `live` keeps
 * it and adds its `denyTools`. Subtractive only, like every step restriction.
 */
export function mcpEvalRestrictions(
  agentServerNames: readonly string[],
  policy: Readonly<Record<string, McpEvalServerPolicy>>,
  stepRestrictions: StepMcpRestriction = {},
): StepMcpRestriction {
  const evalRestrictions: StepMcpRestriction = {};
  for (const name of agentServerNames) {
    const serverPolicy = policy[name];
    if (serverPolicy === undefined || serverPolicy.mode === 'deny') evalRestrictions[name] = { disable: true };
    else if ((serverPolicy.denyTools ?? []).length > 0) evalRestrictions[name] = { denyTools: serverPolicy.denyTools };
  }
  return narrowMcpRestrictions(stepRestrictions, evalRestrictions);
}

/**
 * The MCP servers a step declares inline (the deprecated `agent.mcpServers`).
 * They bypass the agent's bindings, so no eval policy can deny them: a step
 * with any cannot be evaluated (D6).
 */
export function inlineMcpServerNames(step: Pick<WorkflowStep, 'agent'>): string[] {
  return (step.agent?.mcpServers ?? []).map((server) => server.name);
}
