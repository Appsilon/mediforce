import type { StepMcpRestriction } from '../schemas/agent-mcp-binding';
import type { McpEvalServerPolicy } from '../schemas/evaluation';

/**
 * The step restrictions an eval trial runs with (D6): the step's own
 * `mcpRestrictions` plus, for every server the step's agent binds, the eval
 * policy — `deny` (or no entry at all) disables the server, `live` keeps it
 * and adds its `denyTools`. Subtractive only, like every step restriction.
 */
export function mcpEvalRestrictions(
  agentServerNames: readonly string[],
  policy: Readonly<Record<string, McpEvalServerPolicy>>,
  stepRestrictions: StepMcpRestriction = {},
): StepMcpRestriction {
  const merged: StepMcpRestriction = { ...stepRestrictions };
  for (const name of agentServerNames) {
    const serverPolicy = policy[name];
    const existing = merged[name] ?? {};
    if (serverPolicy === undefined || serverPolicy.mode === 'deny') {
      merged[name] = { ...existing, disable: true };
      continue;
    }
    const denyTools = [...new Set([...(existing.denyTools ?? []), ...(serverPolicy.denyTools ?? [])])];
    if (denyTools.length > 0) merged[name] = { ...existing, denyTools };
  }
  return merged;
}
