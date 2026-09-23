import type {
  GetMcpEvalPolicyInput,
  GetMcpEvalPolicyOutput,
  SetMcpEvalPolicyInput,
  SetMcpEvalPolicyOutput,
} from '../../contract/evaluation';
import type { CallerScope } from '../../repositories/index';
import { ValidationError } from '../../errors';
import { loadEvaluatedStep, stepRef, type LoadedStep } from './_lib/evaluated-step';
import { appendEvaluationAudit, authorId } from './_lib/audit';

/** The MCP servers the Step's agent binds — what an eval policy speaks about. */
async function agentServerNames(scope: CallerScope, loaded: LoadedStep): Promise<string[]> {
  if (loaded.step.agentId === undefined) return [];
  const agent = await scope.agentDefinitions.getById(loaded.step.agentId);
  return Object.keys(agent?.mcpServers ?? {}).sort();
}

/** The Step's MCP eval policy and what every server of its agent does in a trial (D6). */
export async function getMcpEvalPolicy(input: GetMcpEvalPolicyInput, scope: CallerScope): Promise<GetMcpEvalPolicyOutput> {
  const loaded = await loadEvaluatedStep(scope, input, 'read');
  const policy = await scope.evaluation.getMcpPolicy(stepRef(input));
  const servers = (await agentServerNames(scope, loaded)).map((name) => {
    const serverPolicy = policy?.servers[name];
    return serverPolicy === undefined
      ? { name, mode: 'deny' as const, defaulted: true }
      : { name, ...serverPolicy, defaulted: false };
  });
  return { policy, servers };
}

/**
 * Replaces the Step's MCP eval policy. Only servers the agent binds may be
 * named; `denyTools` on a server whose binding lists no `allowedTools` is
 * refused, as it is for step restrictions — there is no allowlist to subtract from.
 */
export async function setMcpEvalPolicy(input: SetMcpEvalPolicyInput, scope: CallerScope): Promise<SetMcpEvalPolicyOutput> {
  const step = stepRef(input);
  const loaded = await loadEvaluatedStep(scope, step, 'edit');
  const known = await agentServerNames(scope, loaded);
  const agent = loaded.step.agentId === undefined ? null : await scope.agentDefinitions.getById(loaded.step.agentId);
  for (const [name, serverPolicy] of Object.entries(input.servers)) {
    if (!known.includes(name)) {
      throw new ValidationError(`'${name}' is not an MCP server of this step's agent (${known.join(', ') || 'it has none'})`);
    }
    const binding = agent?.mcpServers?.[name];
    if ((serverPolicy.denyTools?.length ?? 0) > 0 && binding?.allowedTools === undefined) {
      throw new ValidationError(`'${name}' lists no allowedTools, so tools cannot be denied one by one — deny the server or list its tools on the agent`);
    }
  }

  const policy = await scope.evaluation.putMcpPolicy({
    ...step,
    servers: input.servers,
    updatedBy: authorId(scope),
    updatedAt: new Date().toISOString(),
  });
  await appendEvaluationAudit(scope, {
    action: 'mcp_eval_policy.updated',
    description: `MCP eval policy for step '${step.stepId}' of '${step.workflowName}' updated`,
    namespace: step.namespace,
    entityType: 'mcp_eval_policy',
    entityId: `${step.workflowName}/${step.stepId}`,
    inputSnapshot: { ...step, servers: input.servers },
    basis: 'MCP servers are denied in eval trials unless declared safe (ADR-0023 D6)',
  });
  return { policy };
}
