import type {
  GetMcpEvalPolicyInput,
  GetMcpEvalPolicyOutput,
  SetMcpEvalPolicyInput,
  SetMcpEvalPolicyOutput,
} from '../../contract/evaluation';
import type { AgentMcpBinding } from '@mediforce/platform-core';
import type { CallerScope } from '../../repositories/index';
import { ValidationError } from '../../errors';
import { loadEvaluatedStep, stepRef, type LoadedStep } from './_lib/evaluated-step';
import { appendEvaluationAudit, authorId } from './_lib/audit';

/** The MCP servers the Step's agent binds — what an eval policy speaks about. */
async function agentBindings(scope: CallerScope, loaded: LoadedStep): Promise<Record<string, AgentMcpBinding>> {
  if (loaded.step.agentId === undefined) return {};
  const agent = await scope.agentDefinitions.getById(loaded.step.agentId);
  return agent?.mcpServers ?? {};
}

/** The Step's MCP eval policy and what every server of its agent does in a trial (D6). */
export async function getMcpEvalPolicy(input: GetMcpEvalPolicyInput, scope: CallerScope): Promise<GetMcpEvalPolicyOutput> {
  const loaded = await loadEvaluatedStep(scope, input, 'read');
  const policy = await scope.evaluation.getMcpPolicy(stepRef(input));
  const recorded = await scope.evaluation.listMcpRecordedCases(stepRef(input));
  const servers = Object.keys(await agentBindings(scope, loaded)).sort().map((name) => {
    const serverPolicy = policy?.servers[name];
    const recordedCaseIds = recorded.filter((entry) => entry.server === name).map((entry) => entry.caseId).sort();
    return serverPolicy === undefined
      ? { name, mode: 'deny' as const, defaulted: true, recordedCaseIds }
      : { name, ...serverPolicy, defaulted: false, recordedCaseIds };
  });
  return { policy, servers };
}

/**
 * Replaces the Step's MCP eval policy. Only servers the agent binds may be
 * named; `denyTools` on a server whose binding lists no `allowedTools` is
 * refused, as it is for step restrictions — there is no allowlist to subtract
 * from. `denyTools` only applies to a `live` server, so it is dropped from any
 * other — a policy saved before replay existed may carry it on a denied one.
 */
export async function setMcpEvalPolicy(input: SetMcpEvalPolicyInput, scope: CallerScope): Promise<SetMcpEvalPolicyOutput> {
  const step = stepRef(input);
  const loaded = await loadEvaluatedStep(scope, step, 'edit');
  const bindings = await agentBindings(scope, loaded);
  const known = Object.keys(bindings).sort();
  const servers = Object.fromEntries(Object.entries(input.servers).map(([name, serverPolicy]) =>
    [name, serverPolicy.mode === 'live' ? serverPolicy : { mode: serverPolicy.mode }]));
  for (const [name, serverPolicy] of Object.entries(servers)) {
    const binding = bindings[name];
    if (binding === undefined) {
      throw new ValidationError(`'${name}' is not an MCP server of this step's agent (${known.join(', ') || 'it has none'})`);
    }
    if ((serverPolicy.denyTools?.length ?? 0) > 0 && binding.allowedTools === undefined) {
      throw new ValidationError(`'${name}' lists no allowedTools, so tools cannot be denied one by one — deny the server or list its tools on the agent`);
    }
  }

  const policy = await scope.evaluation.putMcpPolicy({
    ...step,
    servers,
    updatedBy: authorId(scope),
    updatedAt: new Date().toISOString(),
  });
  await appendEvaluationAudit(scope, {
    action: 'mcp_eval_policy.updated',
    description: `MCP eval policy for step '${step.stepId}' of '${step.workflowName}' updated`,
    namespace: step.namespace,
    entityType: 'mcp_eval_policy',
    entityId: `${step.workflowName}/${step.stepId}`,
    inputSnapshot: { ...step, servers },
    basis: 'MCP servers are denied in eval trials unless declared live or replayed (ADR-0023 D6)',
  });
  return { policy };
}
