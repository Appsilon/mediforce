// Workflow-native agent step orchestrator.
// Builds the execution context (plugin, MCP, OAuth, secrets, identity) from the
// WorkflowStep, then dispatches to the right StepExecutor strategy:
// AgentStepExecutor (autonomy, review, escalation) or ScriptStepExecutor (direct).

import { getPlatformServices } from './platform-services';
import {
  resolveMcpForStep,
  resolveOAuthToken,
  OAuthTokenUnavailableError,
  PluginNotFoundError,
  type StepExecutorPlugin,
  type ResolvedOAuthBinding,
  type WorkflowAgentContext,
  type StepExecutorServices,
} from '@mediforce/agent-runtime';
import {
  type AgentOAuthTokenRepository,
  type OAuthProviderRepository,
  type ResolvedMcpConfig,
  type WorkflowDefinition,
  type WorkflowStep,
} from '@mediforce/platform-core';
import { getWorkflowSecretsForRuntime } from '../app/actions/workflow-secrets';
import { getNamespaceSecretsForRuntime } from '../app/actions/namespace-secrets';
import { resolveAgentIdentity } from './resolve-agent-identity';

export interface WorkflowAgentStepResult {
  instanceId: string;
  status: string;
  currentStepId: string | null;
  agentRunStatus: string;
}

/**
 * Execute a single agent/script step for a WorkflowDefinition instance.
 *
 * All configuration (executor, plugin, autonomyLevel, params, env) comes from
 * the WorkflowStep embedded in the WorkflowDefinition — no ProcessConfig needed.
 */
export async function executeAgentStep(
  instanceId: string,
  stepId: string,
  workflowStep: WorkflowStep,
  appContext: Record<string, unknown>,
  triggeredBy: string,
  stepExecutionId?: string,
): Promise<WorkflowAgentStepResult> {
  const {
    engine,
    agentRunner,
    scriptStepExecutor,
    agentStepExecutor,
    pluginRegistry,
    instanceRepo,
    processRepo,
    auditRepo,
    humanTaskRepo,
    llmClient,
    agentDefinitionRepo,
    toolCatalogRepo,
    oauthProviderRepo,
    agentOAuthTokenRepo,
    modelRegistryRepo,
  } = getPlatformServices();

  const instance = await instanceRepo.getById(instanceId);
  if (!instance) {
    throw new Error(`Instance not found: ${instanceId}`);
  }

  // Load the full WorkflowDefinition for WorkflowAgentContext
  const workflowDefinition: WorkflowDefinition | null = await processRepo.getWorkflowDefinition(
    instance.namespace ?? '',
    instance.definitionName,
    Number(instance.definitionVersion),
  );
  if (!workflowDefinition) {
    throw new Error(`WorkflowDefinition not found: ${instance.definitionName} v${instance.definitionVersion}`);
  }

  // Resolve plugin: use workflowStep.plugin when set, fall back to stepId
  const pluginId = workflowStep.plugin ?? stepId;
  let plugin: StepExecutorPlugin;
  try {
    plugin = pluginRegistry.get(pluginId);
  } catch (err) {
    if (
      process.env.MOCK_AGENT !== 'true' ||
      workflowStep.executor !== 'agent' ||
      !(err instanceof PluginNotFoundError)
    ) {
      throw err;
    }
    console.warn(`[mock-agent] Plugin "${pluginId}" is not registered; using claude-code-agent mock runtime.`);
    plugin = pluginRegistry.get('claude-code-agent');
  }

  // Resolve autonomy level from step (script steps are always L4)
  const autonomyLevel = workflowStep.executor === 'script' ? 'L4' : (workflowStep.autonomyLevel ?? 'L2');

  // Merge step params into context — stepParams take lower priority than appContext
  const mergedInput: Record<string, unknown> = {
    ...(workflowStep.stepParams ?? {}),
    ...appContext,
  };

  // Pre-fetch secrets for {{TEMPLATE}} resolution.
  // Namespace secrets provide org-wide defaults; workflow secrets override per-workflow.
  const [namespaceSecrets, perWorkflowSecrets] = await Promise.all([
    getNamespaceSecretsForRuntime(workflowDefinition.namespace),
    getWorkflowSecretsForRuntime(workflowDefinition.namespace, workflowDefinition.name),
  ]);
  const workflowSecrets = { ...namespaceSecrets, ...perWorkflowSecrets };

  // Pre-resolve MCP configuration from the agent definition + step restrictions
  // + tool catalog. undefined when step.agentId is unset. Namespace-scoped
  // catalog lookups use the workflow's namespace.
  const resolvedMcpConfig =
    (await resolveMcpForStep(workflowStep, {
      agentDefinitionRepo,
      toolCatalogRepo,
      namespace: workflowDefinition.namespace,
    })) ?? undefined;

  // Load and (lazily) refresh OAuth tokens for every HTTP binding that
  // requested OAuth auth. Done here, not in the runtime, so the runtime
  // stays decoupled from Firestore — queued-docker-spawn can serialize
  // the context over BullMQ once this is populated. Refresh failures
  // bubble up with actionable errors ("Reconnect via UI").
  const oauthTokens =
    workflowStep.agentId !== undefined && resolvedMcpConfig !== undefined
      ? await loadOAuthTokens({
          namespace: workflowDefinition.namespace,
          agentId: workflowStep.agentId,
          resolvedMcpConfig,
          oauthProviderRepo,
          agentOAuthTokenRepo,
        })
      : undefined;

  // Resolve agent identity prompt (systemPrompt) from the AgentDefinition.
  // Returns undefined when step has no agentId or agent has no systemPrompt.
  let agentIdentityPrompt: string | undefined;
  if (workflowStep.agentId !== undefined) {
    agentIdentityPrompt = await resolveAgentIdentity(workflowStep.agentId, agentDefinitionRepo);
  }

  const workflowAgentContext: WorkflowAgentContext = {
    stepId,
    processInstanceId: instanceId,
    runNamespace: instance.namespace ?? '',
    definitionVersion: instance.definitionVersion,
    stepInput: mergedInput,
    autonomyLevel,
    workflowDefinition,
    step: workflowStep,
    llm: llmClient,
    workflowSecrets,
    namespaceSecretKeys: new Set(Object.keys(namespaceSecrets)),
    resolvedMcpConfig,
    ...(instance.previousRun !== undefined ? { previousRun: instance.previousRun } : {}),
    oauthTokens,
    agentIdentityPrompt,
    getPreviousStepOutputs: async () => {
      const executions = await instanceRepo.getStepExecutions(instanceId);
      const result: Record<string, unknown> = {};
      for (const exec of executions) {
        if (exec.output !== null) {
          result[exec.stepId] = exec.output;
        }
      }
      return result;
    },
  };

  const services: StepExecutorServices = {
    auditRepo,
    instanceRepo,
    engine,
    humanTaskRepo,
    modelRegistryRepo,
  };

  const meta = {
    instanceId,
    stepId,
    pluginId,
    triggeredBy,
    stepExecutionId,
    definitionVersion: instance.definitionVersion,
  };

  // Dispatch to the right executor based on step type
  const executor = workflowStep.executor === 'script' ? scriptStepExecutor : agentStepExecutor;

  const executionResult = await executor.execute(plugin, workflowAgentContext, services, meta);

  // Use the executor's authoritative instance state when available (avoids a
  // redundant getById — the executor already updated the instance and knows
  // its final state from engine responses). Fall back to a fresh read when
  // the executor didn't track the instance state (e.g. fallback/unknown paths).
  const instState = executionResult.instanceState;
  if (instState) {
    return {
      instanceId,
      status: instState.status,
      currentStepId: instState.currentStepId,
      agentRunStatus: executionResult.status,
    };
  }

  const currentInstance = await instanceRepo.getById(instanceId);
  return {
    instanceId,
    status: currentInstance?.status ?? executionResult.status,
    currentStepId: currentInstance?.currentStepId ?? null,
    agentRunStatus: executionResult.status,
  };
}

interface LoadOAuthTokensDeps {
  namespace: string;
  agentId: string;
  resolvedMcpConfig: ResolvedMcpConfig;
  oauthProviderRepo: OAuthProviderRepository;
  agentOAuthTokenRepo: AgentOAuthTokenRepository;
}

/** Load and lazy-refresh OAuth tokens for every HTTP binding in the
 *  resolved MCP config whose auth is `type: 'oauth'`. Each token is
 *  refreshed in place (Firestore write) when near expiry before its
 *  accessToken flows into the runtime context. Callers forward refresh
 *  errors up — the workflow then fails with an actionable "Reconnect"
 *  message surfaced in the UI. Returns undefined when no OAuth bindings
 *  are present (so the context field stays absent, not an empty object). */
async function loadOAuthTokens(deps: LoadOAuthTokensDeps): Promise<Record<string, ResolvedOAuthBinding> | undefined> {
  const { namespace, agentId, resolvedMcpConfig, oauthProviderRepo, agentOAuthTokenRepo } = deps;
  const result: Record<string, ResolvedOAuthBinding> = {};

  for (const [serverName, server] of Object.entries(resolvedMcpConfig.servers)) {
    if (server.type !== 'http' || server.auth?.type !== 'oauth') continue;
    const auth = server.auth;

    const providerId = auth.provider;
    const [token, provider] = await Promise.all([
      agentOAuthTokenRepo.get(namespace, agentId, serverName),
      oauthProviderRepo.get(namespace, providerId),
    ]);

    if (token === null) {
      throw new OAuthTokenUnavailableError(serverName, providerId);
    }
    if (provider === null) {
      throw new Error(
        `OAuth provider "${providerId}" (referenced by MCP server "${serverName}") not found in ` +
          `namespace "${namespace}". Recreate the provider in the admin OAuth Providers page, ` +
          `or switch the binding to a different provider.`,
      );
    }

    const { token: fresh, wasRefreshed } = await resolveOAuthToken({ token, provider });
    if (wasRefreshed) {
      await agentOAuthTokenRepo.put(namespace, agentId, serverName, fresh);
    }

    result[serverName] = {
      accessToken: fresh.accessToken,
      headerName: auth.headerName,
      headerValueTemplate: auth.headerValueTemplate,
    };
  }

  return Object.keys(result).length > 0 ? result : undefined;
}
