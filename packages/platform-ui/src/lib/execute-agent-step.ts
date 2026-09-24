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
  MockAgentPlugin,
  ensureStepImageBuilt,
  type StepExecutorPlugin,
  type ResolvedOAuthBinding,
  type WorkflowAgentContext,
  type StepExecutorServices,
} from '@mediforce/agent-runtime';
import {
  applyStepVariant,
  inlineMcpServerNames,
  mcpEvalRestrictions,
  type AgentDefinitionRepository,
  type AgentOAuthTokenRepository,
  type EvaluationRepository,
  type OAuthProviderRepository,
  type ResolvedMcpConfig,
  type WorkflowDefinition,
  type WorkflowStep,
} from '@mediforce/platform-core';
import { getWorkflowSecretsForRuntime } from '../app/actions/workflow-secrets';
import { getNamespaceSecretsForRuntime } from '../app/actions/namespace-secrets';
import { applyAgentModel, resolveAgentDefaults } from './resolve-agent-defaults';

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
  stepFromCaller: WorkflowStep,
  appContext: Record<string, unknown>,
  triggeredBy: string,
  stepExecutionId?: string,
  options?: { reapTimedOut?: boolean },
): Promise<WorkflowAgentStepResult> {
  // Reap mode (ADR-0010): the prior driver died with this step stranded past
  // its timeout. We route the existing execution through the timeout fallback
  // without launching the plugin, so the plugin/MCP/OAuth resolution below is
  // skipped entirely.
  const reapTimedOut = options?.reapTimedOut === true;
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
    evaluationRepo,
  } = getPlatformServices();

  const instance = await instanceRepo.getById(instanceId);
  if (!instance) {
    throw new Error(`Instance not found: ${instanceId}`);
  }

  // Load the full WorkflowDefinition for WorkflowAgentContext
  const storedDefinition: WorkflowDefinition | null = await processRepo.getWorkflowDefinition(
    instance.namespace ?? '',
    instance.definitionName,
    Number(instance.definitionVersion),
  );
  if (!storedDefinition) {
    throw new Error(
      `WorkflowDefinition not found: ${instance.definitionName} v${instance.definitionVersion}`,
    );
  }

  // An eval trial runs its variant of the step (ADR-0023 D5), and its MCP
  // servers under the Eval Run's policy (D6). Everything below reads the
  // step and definition from here.
  const evalTrial = reapTimedOut || instance.evalRunId === undefined
    ? null
    : await evalTrialConfig(storedDefinition, stepFromCaller, instanceId, instance.evalRunId, evaluationRepo, agentDefinitionRepo);
  const workflowDefinition = evalTrial?.definition ?? storedDefinition;
  const workflowStep = evalTrial?.step ?? stepFromCaller;

  // Resolve plugin: use workflowStep.plugin when set, fall back to stepId
  const pluginId = workflowStep.plugin ?? stepId;
  let plugin: StepExecutorPlugin;
  if (instance.dryRun) {
    // Dry run: mock every agent/script step so testing a workflow never runs a
    // real agent, spawns a container, or calls an external service — regardless
    // of the step's plugin (claude / opencode / script-container / databricks-job).
    //
    // The image is built for real first, when the step has one to build. It is
    // the one part of a container step a mock can say nothing about, and the
    // part that takes minutes and fails, so a dry run that skipped it would
    // report a workflow as fine that cannot start. A build failure fails the
    // step, which is the answer the person asked for by running this.
    await ensureStepImageBuilt(workflowStep, workflowDefinition);
    plugin = new MockAgentPlugin();
  } else {
    try {
      plugin = pluginRegistry.get(pluginId);
    } catch (err) {
      if (
        process.env.MOCK_AGENT !== 'true'
        || workflowStep.executor !== 'agent'
        || !(err instanceof PluginNotFoundError)
      ) {
        throw err;
      }
      console.warn(
        `[mock-agent] Plugin "${pluginId}" is not registered; using claude-code-agent mock runtime.`,
      );
      plugin = pluginRegistry.get('claude-code-agent');
    }
  }

  // Resolve autonomy level from step (script steps are always L4)
  const autonomyLevel = workflowStep.executor === 'script'
    ? 'L4'
    : (workflowStep.autonomyLevel ?? 'L2');

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
  const mcpStep = evalTrial?.mcpStep ?? workflowStep;
  const resolvedMcpConfig = reapTimedOut
    ? undefined
    : (await resolveMcpForStep(mcpStep, {
        agentDefinitionRepo,
        toolCatalogRepo,
        namespace: workflowDefinition.namespace,
      })) ?? undefined;

  // Load and (lazily) refresh OAuth tokens for every HTTP binding that
  // requested OAuth auth. Done here, not in the runtime, so the runtime
  // stays decoupled from Firestore — queued-docker-spawn can serialize
  // the context over BullMQ once this is populated. Refresh failures
  // bubble up with actionable errors ("Reconnect via UI").
  const oauthTokens = !reapTimedOut && workflowStep.agentId !== undefined && resolvedMcpConfig !== undefined
    ? await loadOAuthTokens({
        namespace: workflowDefinition.namespace,
        agentId: workflowStep.agentId,
        resolvedMcpConfig,
        oauthProviderRepo,
        agentOAuthTokenRepo,
      })
    : undefined;

  // Resolve what the step inherits from its AgentDefinition: the identity
  // prompt (systemPrompt) and the model. Empty when the step has no agentId.
  const agentDefaults = !reapTimedOut && workflowStep.agentId !== undefined
    ? await resolveAgentDefaults(workflowStep.agentId, agentDefinitionRepo)
    : {};
  const agentIdentityPrompt = agentDefaults.identityPrompt;

  // Picking an agent picks its model unless the step deliberately overrides it.
  const resolvedStep = applyAgentModel(workflowStep, agentDefaults.model);

  const workflowAgentContext: WorkflowAgentContext = {
    stepId,
    processInstanceId: instanceId,
    runNamespace: instance.namespace ?? '',
    definitionVersion: instance.definitionVersion,
    stepInput: mergedInput,
    autonomyLevel,
    workflowDefinition,
    step: resolvedStep,
    llm: llmClient,
    workflowSecrets,
    namespaceSecretKeys: new Set(Object.keys(namespaceSecrets)),
    resolvedMcpConfig,
    ...(instance.previousRun !== undefined
      ? { previousRun: instance.previousRun }
      : {}),
    ...(instance.workspaceStartCommit !== undefined
      ? { workspaceStartCommit: instance.workspaceStartCommit }
      : {}),
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
    reapTimedOut,
  };

  // Dispatch to the right executor based on step type
  const executor = workflowStep.executor === 'script'
    ? scriptStepExecutor
    : agentStepExecutor;

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

/**
 * An eval trial's step (ADR-0023 D4–D6): its variant's patch applied over the
 * pinned definition, and — for MCP resolution only — every server of the
 * step's agent under the Eval Run's frozen policy, denied unless the author
 * declared it live, on top of the step's own restrictions. Inline servers
 * bypass the agent's bindings, so no policy can deny them: the trial fails
 * closed rather than run them.
 */
async function evalTrialConfig(
  definition: WorkflowDefinition,
  step: WorkflowStep,
  instanceId: string,
  evalRunId: string,
  evaluationRepo: EvaluationRepository,
  agentDefinitionRepo: Pick<AgentDefinitionRepository, 'getById'>,
): Promise<{ definition: WorkflowDefinition; step: WorkflowStep; mcpStep: WorkflowStep }> {
  const inlineServers = inlineMcpServerNames(step);
  if (inlineServers.length > 0) {
    throw new Error(
      `Step '${step.id}' declares MCP servers inline (${inlineServers.join(', ')}); `
      + 'an eval trial cannot run them under its MCP eval policy',
    );
  }
  const [evalRun, trial] = await Promise.all([
    evaluationRepo.getEvalRun(evalRunId),
    evaluationRepo.getTrialByInstanceId(instanceId),
  ]);
  if (evalRun === null) throw new Error(`Eval Run '${evalRunId}' of this trial not found`);
  const variant = evalRun.variants.find((candidate) => candidate.id === trial?.variantId);
  if (variant === undefined) throw new Error(`Eval Run '${evalRunId}' has no variant for trial run '${instanceId}'`);
  const patched = applyStepVariant(definition, step, variant.patch);
  if (patched.step.agentId === undefined) return { ...patched, mcpStep: patched.step };
  const agent = await agentDefinitionRepo.getById(patched.step.agentId);
  return {
    ...patched,
    mcpStep: {
      ...patched.step,
      mcpRestrictions: mcpEvalRestrictions(Object.keys(agent?.mcpServers ?? {}), evalRun.mcpPolicy, patched.step.mcpRestrictions),
    },
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
async function loadOAuthTokens(
  deps: LoadOAuthTokensDeps,
): Promise<Record<string, ResolvedOAuthBinding> | undefined> {
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
