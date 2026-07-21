import { NextRequest, NextResponse, after } from 'next/server';
import { getPlatformServices } from '@/lib/platform-services';
import { resolveCallerIdentity, requireNamespaceAccess } from '@/lib/api-auth';
import { executeAgentStep } from '@/lib/execute-agent-step';
import { flattenResolvedMcpToLegacy, resolveMcpForStep, validateWorkflowEnv, validateWorkflowModels, validatePluginRequiredEnv } from '@mediforce/agent-runtime';
import { checkRetiredModels } from '@mediforce/platform-api/handlers';
import { resolveCoworkOutputSchema, resolveStepTimeoutMs, type WorkflowStep, type ProcessInstanceRepository } from '@mediforce/platform-core';
import { validateActionSecrets, isWaitSentinel, interpolate } from '@mediforce/core-actions';
import { getWorkflowSecretsForRuntime } from '@/app/actions/workflow-secrets';
import { getNamespaceSecretsForRuntime } from '@/app/actions/namespace-secrets';
import { isStuckLoop, createLoopTracker, MAX_SAME_STEP_ITERATIONS, hasExceededStepAttempts, resolveStepAttemptCap } from '@/lib/loop-guard';
import { markStepInFlight, clearStepInFlight } from '@/lib/in-flight-registry';

interface RunProcessBody {
  appContext?: Record<string, unknown>;
  triggeredBy?: string;
}

/**
 * In-memory idempotency lock: prevents two concurrent `after()` loops from
 * racing when the same instance receives back-to-back POSTs (e.g. UI button
 * double-click). The lock is held for the entire duration of the auto-runner
 * loop and released in `finally` when the loop exits — there is no TTL,
 * because agent/script steps can run for many minutes and any TTL short
 * enough to bound a stuck lock is also short enough to expire mid-step,
 * which would defeat the guard.
 *
 * Single-process scope only. With multiple Next.js workers/replicas a second
 * worker would not see this Map; the in-loop `hasPendingTask` /
 * `hasActiveSession` guards remain the authoritative cross-process
 * protection. TODO: distributed lock (Firestore transaction or Redis) once
 * the platform-ui scales out beyond a single process.
 */
const runLocks = new Set<string>();

function tryAcquireRunLock(instanceId: string): boolean {
  if (runLocks.has(instanceId)) return false;
  runLocks.add(instanceId);
  return true;
}

function releaseRunLock(instanceId: string): void {
  runLocks.delete(instanceId);
}

/**
 * Fail the run when a step exceeds the persisted attempt cap (ADR-0010),
 * bounding re-kick / re-dispatch loops that survive process deaths (e.g. a hung
 * action with no timeout, a step re-kicked by the heartbeat). Returns true when
 * the run was failed, so the caller breaks the auto-runner loop.
 */
async function failRunIfStepAttemptsExceeded(
  instanceRepo: ProcessInstanceRepository,
  instanceId: string,
  stepId: string,
  step: WorkflowStep,
  priorExecutionsForStep: number,
): Promise<boolean> {
  if (!hasExceededStepAttempts(priorExecutionsForStep, step.review?.maxIterations)) {
    return false;
  }
  const cap = resolveStepAttemptCap(step.review?.maxIterations);
  const message = `Step '${stepId}' exceeded ${cap} attempts — failing run to prevent an unbounded retry loop`;
  console.error(`[auto-runner] ${message}`);
  await instanceRepo.update(instanceId, {
    status: 'failed',
    error: message,
    updatedAt: new Date().toISOString(),
  });
  return true;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ instanceId: string }> },
): Promise<NextResponse> {
  const { instanceId } = await params;
  const { instanceRepo, processRepo, auditRepo, namespaceRepo } = getPlatformServices();
  let runLockAcquired = false;

  const caller = await resolveCallerIdentity(req, namespaceRepo);
  if (caller instanceof NextResponse) return caller;

  try {
    const body = (await req.json().catch(() => ({}))) as RunProcessBody;

    // Load instance
    const initialInstance = await instanceRepo.getById(instanceId);
    if (!initialInstance) {
      return NextResponse.json({ error: 'Instance not found' }, { status: 404 });
    }

    const denied = requireNamespaceAccess(caller, initialInstance.namespace);
    if (denied) return denied;

    const definitionVersion = initialInstance.definitionVersion;

    // Must be in running state to auto-run
    if (initialInstance.status !== 'running') {
      return NextResponse.json(
        { error: 'Instance is not in running state', status: initialInstance.status },
        { status: 409 },
      );
    }

    // Idempotency: refuse if another run for this instance started < TTL ago.
    if (!tryAcquireRunLock(instanceId)) {
      return NextResponse.json(
        { error: 'Auto-runner already in progress for this instance', instanceId },
        { status: 409 },
      );
    }
    runLockAcquired = true;

    // Load WorkflowDefinition — try exact version, fall back to latest
    const versionNum = parseInt(initialInstance.definitionVersion, 10);
    const runNamespace = initialInstance.namespace ?? '';
    let workflowDefinition = !isNaN(versionNum)
      ? await processRepo.getWorkflowDefinition(runNamespace, initialInstance.definitionName, versionNum)
      : null;
    if (!workflowDefinition) {
      const latestVersion = await processRepo.getLatestWorkflowVersion(runNamespace, initialInstance.definitionName);
      if (latestVersion > 0) {
        workflowDefinition = await processRepo.getWorkflowDefinition(runNamespace, initialInstance.definitionName, latestVersion);
      }
    }
    if (!workflowDefinition) {
      releaseRunLock(instanceId);
      runLockAcquired = false;
      return NextResponse.json(
        { error: 'WorkflowDefinition not found — run migration first', definitionName: initialInstance.definitionName },
        { status: 404 },
      );
    }

    // Pre-flight: validate all env templates are resolvable before executing anything.
    // The decrypted bag is also reused below as the `secrets` source for action
    // interpolation (`${secrets.NAME}` in http urls/headers/body).
    const [namespaceSecrets, perWorkflowSecrets] = await Promise.all([
      getNamespaceSecretsForRuntime(workflowDefinition.namespace),
      getWorkflowSecretsForRuntime(workflowDefinition.namespace, workflowDefinition.name),
    ]);
    const workflowSecrets = { ...namespaceSecrets, ...perWorkflowSecrets };
    {
      const missingEnv = validateWorkflowEnv(workflowDefinition, workflowSecrets);
      const missingActionSecrets = validateActionSecrets(
        workflowDefinition.steps,
        workflowSecrets,
      );

      // Check plugin-required env vars (implicit agent needs like ANTHROPIC_API_KEY)
      const { pluginRegistry } = getPlatformServices();
      const pluginRequiredEnvMap = new Map<string, string[][]>();
      for (const { name, metadata } of pluginRegistry.list()) {
        if (metadata?.requiredEnv) {
          pluginRequiredEnvMap.set(name, metadata.requiredEnv);
        }
      }
      const missingPluginEnv = validatePluginRequiredEnv(
        workflowDefinition, pluginRequiredEnvMap, workflowSecrets,
      );
      const pluginEnvAsMissing = missingPluginEnv.flatMap((m) => {
        const bestGroup = m.groups.reduce((a, b) => a.missing.length <= b.missing.length ? a : b);
        return bestGroup.missing.map((key) => ({
          secretName: key,
          template: `{{${key}}}`,
          steps: m.steps,
          hint: `Required by ${m.pluginName}` +
            (m.groups.length > 1
              ? `. Alternatives: ${m.groups.map((g) => g.keys.join(' + ')).join(' or ')}`
              : ''),
        }));
      });

      const allMissing = [
        ...missingEnv,
        ...missingActionSecrets.map((m) => ({ ...m, template: `\${secrets.${m.secretName}}` })),
        ...pluginEnvAsMissing,
      ];
      if (allMissing.length > 0) {
        const names = allMissing.map((m) => m.secretName);
        console.log(`[auto-runner] Missing secrets for '${initialInstance.definitionName}': ${names.join(', ')}`);
        await instanceRepo.update(instanceId, {
          status: 'paused',
          pauseReason: 'missing_env',
          error: JSON.stringify(allMissing),
          updatedAt: new Date().toISOString(),
        });
        releaseRunLock(instanceId);
        runLockAcquired = false;
        return NextResponse.json(
          { error: 'Missing environment variables', missing: allMissing, instanceId },
          { status: 422 },
        );
      }
    }

    // Pre-flight: validate agent step models exist in the registry and are not retired.
    {
      const { modelRegistryRepo } = getPlatformServices();
      const allModels = await modelRegistryRepo.list();

      const knownIds = new Set(allModels.map((m) => m.id));
      const unknownModels = validateWorkflowModels(workflowDefinition, knownIds);
      if (unknownModels.length > 0) {
        const detail = unknownModels
          .map((u) => `model '${u.model}' in step(s) ${u.steps.map((s) => `'${s.stepId}'`).join(', ')}`)
          .join('; ');
        const message = `Unknown model(s): ${detail}. Check the model name or sync the model registry.`;
        console.log(`[auto-runner] ${message}`);
        await instanceRepo.update(instanceId, {
          status: 'paused',
          pauseReason: 'missing_env',
          error: message,
          updatedAt: new Date().toISOString(),
        });
        releaseRunLock(instanceId);
        runLockAcquired = false;
        return NextResponse.json(
          { error: message, unknownModels, instanceId },
          { status: 422 },
        );
      }

      const retired = checkRetiredModels(workflowDefinition, allModels);
      if (retired !== null) {
        console.log(`[auto-runner] ${retired.message}`);
        await instanceRepo.update(instanceId, {
          status: 'paused',
          pauseReason: 'retired_model',
          error: retired.message,
          updatedAt: new Date().toISOString(),
        });
        releaseRunLock(instanceId);
        runLockAcquired = false;
        return NextResponse.json(
          { error: retired.message, retiredModels: retired.refs, instanceId },
          { status: 422 },
        );
      }
    }

    const appContext: Record<string, unknown> = body.appContext
      ?? (initialInstance.triggerPayload as Record<string, unknown>)
      ?? {};
    const triggeredBy = body.triggeredBy;

    // Return 202 immediately — long-running execution happens in after().
    // Prevents undici/proxy headers timeout from killing the handler on long
    // agent steps. Loop continues in background and updates Firestore;
    // clients poll instance state for progress.
    after(async () => {
      let stepsExecuted = 0;
      let lastActiveStepId: string | null = null;
      try {
        const agentStepCount = workflowDefinition.steps.filter(
          (s) => s.executor === 'agent',
        ).length;
        const scriptStepCount = workflowDefinition.steps.filter(
          (s) => s.executor === 'script',
        ).length;
        const stepCountParts: string[] = [];
        if (agentStepCount > 0) stepCountParts.push(`${agentStepCount} agent step(s)`);
        if (scriptStepCount > 0) stepCountParts.push(`${scriptStepCount} script step(s)`);
        const stepCountDescription = stepCountParts.length > 0
          ? stepCountParts.join(', ')
          : '0 step(s)';
        await auditRepo.append({
          actorId: 'auto-runner',
          actorType: 'system',
          actorRole: 'orchestrator',
          action: 'process.run.started',
          description: `Auto-runner started for '${initialInstance.definitionName}' (workflow) — ${stepCountDescription} to execute`,
          timestamp: new Date().toISOString(),
          inputSnapshot: { definitionName: initialInstance.definitionName, definitionVersion: initialInstance.definitionVersion, appContext, triggeredBy: triggeredBy ?? 'auto-runner' },
          outputSnapshot: {},
          basis: 'Auto-run triggered after workflow start',
          entityType: 'processInstance',
          entityId: instanceId,
          processInstanceId: instanceId,
          processDefinitionVersion: initialInstance.definitionVersion,
        });

        // Execution loop for WorkflowDefinition instances
        const loopTracker = createLoopTracker();

        while (true) {
          const instance = await instanceRepo.getById(instanceId);
          if (!instance) break;
          if (instance.status !== 'running') break;
          if (instance.currentStepId === null) break;

          lastActiveStepId = instance.currentStepId;

          if (isStuckLoop(instance.currentStepId, loopTracker)) {
            const executions = await instanceRepo.getStepExecutions(instanceId);
            const lastFailed = executions
              .filter((e) => e.stepId === instance.currentStepId && e.status === 'failed' && e.error)
              .at(-1);
            const cause = lastFailed?.error ? ` — last error: ${lastFailed.error}` : '';
            const message = `Auto-runner stuck: step '${instance.currentStepId}' looped ${MAX_SAME_STEP_ITERATIONS} times${cause}`;
            console.error(`[auto-runner] Safety guard: ${message} — aborting instance ${instanceId}`);
            await instanceRepo.update(instanceId, {
              status: 'failed',
              error: message,
              updatedAt: new Date().toISOString(),
            });
            break;
          }

          const currentStep = workflowDefinition.steps.find((s) => s.id === instance.currentStepId);
          if (!currentStep) {
            await instanceRepo.update(instanceId, {
              status: 'failed',
              error: `Unknown step: ${instance.currentStepId}`,
              updatedAt: new Date().toISOString(),
            });
            break;
          }

          if (currentStep.type === 'terminal') break;

          // Guard: skip if a pending/claimed task already exists (prevents race condition duplicates)
          const { humanTaskRepo, userDirectory } = getPlatformServices();
          const existingTasks = await humanTaskRepo.getByInstanceId(instanceId);
          const hasPendingTask = existingTasks.some(
            (t) => t.stepId === instance.currentStepId && (t.status === 'pending' || t.status === 'claimed'),
          );
          if (hasPendingTask) {
            console.log(`[auto-runner] Duplicate guard: pending task already exists for step '${instance.currentStepId}' on instance '${instanceId}' — pausing`);
            if (instance.status === 'running') {
              await instanceRepo.update(instanceId, {
                status: 'paused',
                pauseReason: 'waiting_for_human',
                updatedAt: new Date().toISOString(),
              });
            }
            break;
          }

          if (currentStep.executor === 'cowork') {
            // Guard: skip if an active cowork session already exists for this step
            const { coworkSessionRepo, agentDefinitionRepo, toolCatalogRepo } = getPlatformServices();
            const existingSessions = await coworkSessionRepo.getByInstanceId(instanceId);
            const hasActiveSession = existingSessions.some(
              (s) => s.stepId === instance.currentStepId && s.status === 'active',
            );
            if (hasActiveSession) {
              console.log(`[auto-runner] Duplicate guard: active cowork session already exists for step '${instance.currentStepId}' on instance '${instanceId}' — pausing`);
              if (instance.status === 'running') {
                await instanceRepo.update(instanceId, {
                  status: 'paused',
                  pauseReason: 'cowork_in_progress',
                  updatedAt: new Date().toISOString(),
                });
              }
              break;
            }

            const now = new Date().toISOString();
            const sessionId = crypto.randomUUID();

            // Resolve MCP config for the step if it points at an AgentDefinition.
            // Falls back to legacy inline cowork.mcpServers when agentId is unset
            // (workflows not yet migrated).
            const resolvedMcp = await resolveMcpForStep(currentStep, {
              agentDefinitionRepo,
              toolCatalogRepo,
              namespace: workflowDefinition.namespace,
            });
            const sessionMcpServers = resolvedMcp !== null
              ? flattenResolvedMcpToLegacy(resolvedMcp)
              : (currentStep.cowork?.mcpServers ?? null);

            const agentType = currentStep.cowork?.agent ?? 'chat';
            const model = agentType === 'voice-realtime'
              ? (currentStep.cowork?.voiceRealtime?.model ?? 'gpt-4o-realtime-preview')
              : (currentStep.cowork?.chat?.model ?? null);
            const voiceConfig = agentType === 'voice-realtime'
              ? {
                  voice: currentStep.cowork?.voiceRealtime?.voice ?? 'alloy',
                  synthesisModel: currentStep.cowork?.voiceRealtime?.synthesisModel ?? 'anthropic/claude-sonnet-4',
                  maxDurationSeconds: currentStep.cowork?.voiceRealtime?.maxDurationSeconds ?? 600,
                  idleTimeoutSeconds: currentStep.cowork?.voiceRealtime?.idleTimeoutSeconds ?? 60,
                }
              : null;

            await coworkSessionRepo.create({
              id: sessionId,
              processInstanceId: instanceId,
              stepId: instance.currentStepId,
              assignedRole: currentStep.allowedRoles?.[0] ?? 'unassigned',
              assignedUserId: null,
              status: 'active',
              agent: agentType,
              model,
              systemPrompt: currentStep.cowork?.systemPrompt ?? null,
              outputSchema: resolveCoworkOutputSchema(currentStep.cowork),
              voiceConfig,
              artifact: null,
              validationResult: null,
              presentation: null,
              mcpServers: sessionMcpServers,
              turns: [],
              createdAt: now,
              updatedAt: now,
              finalizedAt: null,
            });

            await auditRepo.append({
              actorId: 'auto-runner',
              actorType: 'system',
              actorRole: 'orchestrator',
              action: 'cowork.session.created',
              description: `Cowork session created for step '${instance.currentStepId}'`,
              timestamp: now,
              inputSnapshot: { sessionId, stepId: instance.currentStepId, agent: agentType, assignedRole: currentStep.allowedRoles?.[0] ?? 'unassigned' },
              outputSnapshot: {},
              basis: 'Cowork executor step reached in auto-runner loop',
              entityType: 'coworkSession',
              entityId: sessionId,
              processInstanceId: instanceId,
              processDefinitionVersion: initialInstance.definitionVersion,
            });

            await instanceRepo.update(instanceId, {
              status: 'paused',
              pauseReason: 'cowork_in_progress',
              updatedAt: now,
            });
            break;
          }

          if (currentStep.executor === 'human') {
            const now = new Date().toISOString();
            const taskId = crypto.randomUUID();

            // For selection review steps, pass options from the previous step's output
            const previousStepId = workflowDefinition.transitions.find(
              (t) => t.to === instance.currentStepId,
            )?.from ?? null;
            const previousOutput = previousStepId
              ? (instance.variables?.[previousStepId] ?? null)
              : null;
            const options = currentStep.selection && previousOutput && Array.isArray((previousOutput as Record<string, unknown>).options)
              ? (previousOutput as Record<string, unknown>).options as Array<Record<string, unknown>>
              : undefined;

            // Pre-assignment: when the step declares `assignedTo`, interpolate it
            // against the run's sources and pin the task to that user (status
            // 'claimed'). A template that resolves to nothing is a hard failure —
            // a step that asked to be pre-assigned must not silently fall back to
            // an open, role-wide task.
            let assignedUserId: string | null = null;
            let taskStatus: 'pending' | 'claimed' = 'pending';
            if (currentStep.assignedTo !== undefined) {
              const resolved = interpolate(currentStep.assignedTo, {
                triggerPayload: (instance.triggerPayload as Record<string, unknown>) ?? {},
                steps: instance.variables,
                variables: instance.variables,
                // Secrets are deliberately withheld: the resolved value is persisted
                // as the task's assignedUserId and shown in the UI/audit, and secrets
                // must never be persisted. A `${secrets.*}` template resolves to
                // nothing here and hard-fails below — a secret is never an assignee.
                secrets: {},
              });
              if (typeof resolved === 'string' && resolved.length > 0) {
                // The persisted assignedUserId must be a Mediforce uid: the task
                // queues surface a claimed task only to the viewer whose uid
                // matches. An email-shaped value (workflows may configure
                // assignees by email) resolves to its uid via the directory
                // first; a value that matches no user hard-fails rather than
                // stranding the task in nobody's queue. Non-email values pass
                // through unchanged (already a uid).
                let resolvedUserId = resolved;
                if (resolved.includes('@') && userDirectory?.resolveUser !== undefined) {
                  const directoryUser = await userDirectory.resolveUser(resolved);
                  if (directoryUser === null) {
                    await instanceRepo.update(instanceId, {
                      status: 'failed',
                      error: `Step '${currentStep.id}': assignedTo '${currentStep.assignedTo}' resolved to '${resolved}', which matches no Mediforce user — cannot pre-assign human task`,
                      updatedAt: new Date().toISOString(),
                    });
                    break;
                  }
                  resolvedUserId = directoryUser.uid;
                }
                assignedUserId = resolvedUserId;
                taskStatus = 'claimed';
              } else {
                await instanceRepo.update(instanceId, {
                  status: 'failed',
                  error: `Step '${currentStep.id}': assignedTo '${currentStep.assignedTo}' resolved to empty — cannot pre-assign human task`,
                  updatedAt: new Date().toISOString(),
                });
                break;
              }
            }

            await humanTaskRepo.create({
              id: taskId,
              processInstanceId: instanceId,
              stepId: instance.currentStepId,
              assignedRole: currentStep.allowedRoles?.[0] ?? 'unassigned',
              assignedUserId,
              status: taskStatus,
              deadline: null,
              createdAt: now,
              updatedAt: now,
              completedAt: null,
              completionData: null,
              creationReason: 'human_executor',
              ...(currentStep.ui ? { ui: currentStep.ui } : {}),
              ...(currentStep.params?.length ? { params: currentStep.params } : {}),
              ...(options ? { options } : {}),
            });

            await auditRepo.append({
              actorId: 'auto-runner',
              actorType: 'system',
              actorRole: 'orchestrator',
              action: 'task.created',
              description: `Human task created for step '${instance.currentStepId}' (reason: human_executor)`,
              timestamp: now,
              inputSnapshot: { taskId, stepId: instance.currentStepId, reason: 'human_executor', assignedRole: currentStep.allowedRoles?.[0] ?? 'unassigned', assignedUserId },
              outputSnapshot: {},
              basis: 'Human executor step reached in auto-runner loop',
              entityType: 'humanTask',
              entityId: taskId,
              processInstanceId: instanceId,
              processDefinitionVersion: initialInstance.definitionVersion,
            });

            await instanceRepo.update(instanceId, {
              status: 'paused',
              pauseReason: 'waiting_for_human',
              updatedAt: new Date().toISOString(),
            });

            // Dispatch task_assigned notification when the workflow declares
            // one. Shared with the engine's advanceStep path so an
            // already-current human step (e.g. a workflow whose first step is
            // human) notifies role members / the assignee instead of staying
            // pull-only. Sent after the pause so a notification failure cannot
            // strand a created task with a non-paused instance.
            const { engine } = getPlatformServices();
            await engine.dispatchTaskAssignedNotification(workflowDefinition, {
              instanceId,
              stepId: instance.currentStepId,
              assignedRole: currentStep.allowedRoles?.[0] ?? 'unassigned',
              taskId,
              assigneeUserId: assignedUserId,
            });
            break;
          }

          if (currentStep.executor === 'action') {
            if (!currentStep.action) {
              await instanceRepo.update(instanceId, {
                status: 'failed',
                error: `Step '${currentStep.id}' has executor='action' but no action config`,
                updatedAt: new Date().toISOString(),
              });
              break;
            }

            const { actionRegistry, engine } = getPlatformServices();

            // Wait actions: if resumeWait already wrote the step output, skip dispatch
            if (currentStep.action.kind === 'wait') {
              const preResolved = instance.variables[instance.currentStepId] as Record<string, unknown> | undefined;
              if (preResolved?.resumeReason) {
                console.log(`[auto-runner] Wait step '${instance.currentStepId}' already resolved (${preResolved.resumeReason}) — advancing`);
                await engine.advanceStep(instanceId, preResolved, { id: 'auto-runner', role: 'system' });
                stepsExecuted++;
                continue;
              }
            }

            console.log(`[auto-runner] Executing action step '${instance.currentStepId}' (kind: ${currentStep.action.kind}) on instance '${instanceId}'`);

            const previousStepId = workflowDefinition.transitions.find(
              (t) => t.to === instance.currentStepId,
            )?.from ?? null;
            const previousStepOutput = previousStepId
              ? (instance.variables[previousStepId] as Record<string, unknown>) ?? {}
              : {};
            const stepInput = { ...previousStepOutput, steps: instance.variables };

            const executionId = crypto.randomUUID();
            const startedAt = new Date().toISOString();
            // Iteration count = number of prior executions of this same step on
            // this instance. Lets revise loops surface as iter 1, 2, 3 in audit
            // and UI rather than every execution showing as iter 0.
            const priorExecutionsForStep = (await instanceRepo.getStepExecutions(instanceId))
              .filter((e) => e.stepId === instance.currentStepId).length;

            if (await failRunIfStepAttemptsExceeded(instanceRepo, instanceId, currentStep.id, currentStep, priorExecutionsForStep)) {
              break;
            }

            await instanceRepo.addStepExecution(instanceId, {
              id: executionId,
              instanceId,
              stepId: instance.currentStepId,
              status: 'running',
              input: stepInput,
              output: null,
              verdict: null,
              executedBy: 'auto-runner',
              startedAt,
              completedAt: null,
              iterationNumber: priorExecutionsForStep,
              gateResult: null,
              error: null,
            });

            await auditRepo.append({
              actorId: 'auto-runner',
              actorType: 'system',
              actorRole: 'orchestrator',
              action: 'process.run.step.started',
              description: `Auto-runner dispatching action step '${instance.currentStepId}' (kind: ${currentStep.action.kind})`,
              timestamp: startedAt,
              inputSnapshot: { stepId: instance.currentStepId, actionKind: currentStep.action.kind },
              outputSnapshot: {},
              basis: 'Auto-run loop: action step dispatch',
              entityType: 'processInstance',
              entityId: instanceId,
              processInstanceId: instanceId,
              processDefinitionVersion: initialInstance.definitionVersion,
            });

            try {
              const output = await actionRegistry.dispatch(currentStep.action, {
                stepId: instance.currentStepId,
                processInstanceId: instanceId,
                namespace: instance.namespace ?? '',
                definitionName: instance.definitionName,
                ...(instance.dryRun ? { dryRun: true } : {}),
                sources: {
                  triggerPayload: (instance.triggerPayload as Record<string, unknown>) ?? {},
                  steps: instance.variables,
                  variables: instance.variables,
                  secrets: workflowSecrets,
                },
              });

              if (isWaitSentinel(output)) {
                const waitMeta = output.__wait;
                if (waitMeta.stepId === instance.currentStepId) {
                  await instanceRepo.updateStepExecution(instanceId, executionId, {
                    status: 'paused',
                    output: null,
                  });
                  await instanceRepo.update(instanceId, {
                    status: 'paused',
                    pauseReason: 'waiting_for_timer',
                    variables: { ...instance.variables, __wait: waitMeta },
                    updatedAt: new Date().toISOString(),
                  });

                  // Verify the write persisted. Two sequential writes with no
                  // transaction guarantee mean the second write (pauseReason +
                  // __wait) can be lost silently — the run ends up paused/null,
                  // invisible to the heartbeat sweep, and stranded forever.
                  const afterWrite = await instanceRepo.getById(instanceId);
                  if (afterWrite?.pauseReason !== 'waiting_for_timer') {
                    console.error(
                      `[auto-runner] Wait sentinel write lost for '${instanceId}': ` +
                      `pauseReason=${afterWrite?.pauseReason} — escalating to failed`,
                    );
                    await instanceRepo.update(instanceId, {
                      status: 'failed',
                      error:
                        `Wait step '${instance.currentStepId}' could not register its timer — ` +
                        `the scheduler metadata was not persisted. ` +
                        `Resume this run to restart from the wait step.`,
                      updatedAt: new Date().toISOString(),
                    });
                  } else {
                    console.log(`[auto-runner] Wait action paused instance '${instanceId}' until ${waitMeta.resumeAt}`);
                  }
                  break;
                }
              }

              await instanceRepo.updateStepExecution(instanceId, executionId, {
                status: 'completed',
                output,
                completedAt: new Date().toISOString(),
              });

              await engine.advanceStep(
                instanceId,
                output,
                { id: 'auto-runner', role: 'system' },
              );

              stepsExecuted++;
              continue;
            } catch (err) {
              const rootMessage = err instanceof Error ? err.message : String(err);
              const message = `Step '${currentStep.id}' (action: ${currentStep.action.kind}) failed: ${rootMessage}`;
              await instanceRepo.updateStepExecution(instanceId, executionId, {
                status: 'failed',
                completedAt: new Date().toISOString(),
                error: message,
              });

              if (currentStep.continueOnError === true) {
                console.warn(
                  `[auto-runner] Action step '${currentStep.id}' failed but continueOnError=true — logging as warning and advancing:`,
                  err,
                );
                await auditRepo.append({
                  actorId: 'auto-runner',
                  actorType: 'system',
                  actorRole: 'orchestrator',
                  action: 'process.run.step.warning',
                  description: `Step '${currentStep.id}' failed (continueOnError=true): ${rootMessage}`,
                  timestamp: new Date().toISOString(),
                  inputSnapshot: { stepId: currentStep.id, actionKind: currentStep.action.kind },
                  outputSnapshot: { error: rootMessage },
                  basis: 'continueOnError flag set on step — workflow advances despite failure',
                  entityType: 'processInstance',
                  entityId: instanceId,
                  processInstanceId: instanceId,
                  processDefinitionVersion: initialInstance.definitionVersion,
                });
                // Advance with an empty output envelope so transitions can fire normally.
                await engine.advanceStep(
                  instanceId,
                  {},
                  { id: 'auto-runner', role: 'system' },
                );
                stepsExecuted++;
                continue;
              }

              console.error(`[auto-runner] Action step '${currentStep.id}' failed:`, err);
              await instanceRepo.update(instanceId, {
                status: 'failed',
                error: message,
                updatedAt: new Date().toISOString(),
              });
              break;
            }
          }

          if (currentStep.executor === 'agent' || currentStep.executor === 'script') {
            console.log(`[auto-runner] Executing workflow agent step '${instance.currentStepId}' on instance '${instanceId}' (iteration ${stepsExecuted})`);

            // Reap guard (ADR-0010): a prior driver (or drivers) may have died
            // with this step still `running`. Rather than launch a duplicate
            // attempt, gather EVERY still-running execution of this step and, once
            // they are all past their timeout, reap each through the timeout
            // fallback (fail/escalate/flag per fallbackBehavior). If any row is a
            // not-yet-overdue live attempt, defer wholesale to the heartbeat — we
            // never reap rows out from under, or double-run, live work.
            const stepExecutions = await instanceRepo.getStepExecutions(instanceId);
            const timeoutMs = resolveStepTimeoutMs(currentStep);
            const inFlight = stepExecutions.filter(
              (e) => e.stepId === instance.currentStepId && e.status === 'running',
            );
            if (inFlight.length > 0) {
              const hasLiveAttempt = inFlight.some(
                (e) => Date.now() - new Date(e.startedAt).getTime() < timeoutMs,
              );
              if (hasLiveAttempt) {
                console.log(`[auto-runner] Step '${instance.currentStepId}' has an in-flight execution not yet past its ${Math.round(timeoutMs / 60_000)}m timeout — deferring to heartbeat`);
                break;
              }

              // All in-flight rows are stranded past the timeout — reap every one
              // so none is left showing running forever.
              console.log(`[auto-runner] Reaping ${inFlight.length} stranded execution(s) of step '${instance.currentStepId}' as timeout (all past their ${Math.round(timeoutMs / 60_000)}m timeout)`);
              for (const stranded of inFlight) {
                await executeAgentStep(
                  instanceId,
                  instance.currentStepId,
                  currentStep,
                  appContext,
                  triggeredBy ?? 'auto-runner',
                  stranded.id,
                  { reapTimedOut: true },
                );
              }
              stepsExecuted++;

              // A `continue_with_flag` fallback reaps to status 'flagged' and
              // leaves the instance running on the same step. Without advancing,
              // the loop would re-enter with no running execution and dispatch a
              // fresh attempt — restarting the very step we just timed out. Move
              // the run forward with an empty envelope so it leaves the stranded
              // state. Escalate/pause fallbacks already paused the instance and
              // fall through to the loop's status check on the next pass.
              const afterReap = await instanceRepo.getById(instanceId);
              if (afterReap?.status === 'running' && afterReap.currentStepId === instance.currentStepId) {
                console.log(`[auto-runner] Reaped step '${instance.currentStepId}' left the run on the same step (continue_with_flag) — advancing past it`);
                const { engine } = getPlatformServices();
                await engine.advanceStep(instanceId, {}, { id: 'auto-runner', role: 'system' });
              }
              continue;
            }

            // Retry branch (ADR-0010 §4): a prior execution marked `interrupted`
            // by the SIGTERM shutdown hook means we KNOW the driver was recycled
            // by a deploy, not that the step genuinely timed out. Unlike the
            // reap-as-timeout path above (which honours `fallbackBehavior`), an
            // interrupted step gets a fresh attempt below. The interrupted rows
            // stay as terminal-ish records and count toward the persisted
            // `MAX_STEP_ATTEMPTS` cap, so this retry can't loop unbounded.
            const interruptedForStep = stepExecutions.filter(
              (e) => e.stepId === instance.currentStepId && e.status === 'interrupted',
            );
            if (interruptedForStep.length > 0) {
              console.log(`[auto-runner] Step '${instance.currentStepId}' has ${interruptedForStep.length} execution(s) interrupted by a prior shutdown (deploy) — retrying with a fresh attempt`);
            }

            const previousStepId = workflowDefinition.transitions.find(
              (t) => t.to === instance.currentStepId,
            )?.from ?? null;
            const previousStepOutput = previousStepId
              ? (instance.variables[previousStepId] as Record<string, unknown>) ?? {}
              : {};
            const stepInput = { ...previousStepOutput, steps: instance.variables };

            const executionId = crypto.randomUUID();
            // Iteration count = number of prior executions of this same step on
            // this instance. Lets revise loops surface as iter 1, 2, 3 in audit
            // and UI rather than every execution showing as iter 0.
            const priorExecutionsForStep = stepExecutions
              .filter((e) => e.stepId === instance.currentStepId).length;

            if (await failRunIfStepAttemptsExceeded(instanceRepo, instanceId, currentStep.id, currentStep, priorExecutionsForStep)) {
              break;
            }

            await instanceRepo.addStepExecution(instanceId, {
              id: executionId,
              instanceId,
              stepId: instance.currentStepId,
              status: 'running',
              input: stepInput,
              output: null,
              verdict: null,
              executedBy: 'auto-runner',
              startedAt: new Date().toISOString(),
              completedAt: null,
              iterationNumber: priorExecutionsForStep,
              gateResult: null,
              error: null,
            });

            await auditRepo.append({
              actorId: 'auto-runner',
              actorType: 'system',
              actorRole: 'orchestrator',
              action: 'process.run.step.started',
              description: `Auto-runner dispatching workflow step '${instance.currentStepId}'`,
              timestamp: new Date().toISOString(),
              inputSnapshot: { stepId: instance.currentStepId, appContext },
              outputSnapshot: {},
              basis: 'Auto-run loop: workflow agent step dispatch',
              entityType: 'processInstance',
              entityId: instanceId,
              processInstanceId: instanceId,
              processDefinitionVersion: initialInstance.definitionVersion,
            });

            const mergedAppContext = { ...appContext, ...stepInput };
            // Register this execution as in-flight for the shutdown hook
            // (ADR-0010 §4): if a deploy SIGTERMs this process while the plugin
            // is running, the hook marks `executionId` interrupted so the next
            // boot retries it in seconds instead of waiting out the timeout+grace.
            markStepInFlight(instanceId, executionId);
            try {
              await executeAgentStep(
                instanceId,
                instance.currentStepId,
                currentStep,
                mergedAppContext,
                triggeredBy ?? 'auto-runner',
                executionId,
              );
            } finally {
              clearStepInFlight(instanceId);
            }

            stepsExecuted++;
          } else if (
            currentStep.executor !== 'cowork' &&
            currentStep.executor !== 'human' &&
            currentStep.executor !== 'action'
          ) {
            await instanceRepo.update(instanceId, {
              status: 'failed',
              error: `Unknown executor '${currentStep.executor}' for step '${instance.currentStepId}'`,
              updatedAt: new Date().toISOString(),
            });
            break;
          }
        }

        console.log(`[auto-runner] Completed for instance '${instanceId}' — ${stepsExecuted} step(s) executed`);
      } catch (err) {
        const rootMessage = err instanceof Error ? err.message : 'Unknown error';
        const stepContext = lastActiveStepId !== null ? ` (crashed while processing step '${lastActiveStepId}')` : '';
        const message = `${rootMessage}${stepContext}`;

        console.error(`[auto-runner] Unhandled error for instance '${instanceId}':`, err);

        try {
          await auditRepo.append({
            actorId: 'auto-runner',
            actorType: 'system',
            actorRole: 'orchestrator',
            action: 'process.run.failed',
            description: `Auto-runner crashed for '${instanceId}': ${message}`,
            timestamp: new Date().toISOString(),
            inputSnapshot: {},
            outputSnapshot: { error: message },
            basis: 'Unhandled exception in auto-runner loop',
            entityType: 'processInstance',
            entityId: instanceId,
            processInstanceId: instanceId,
            processDefinitionVersion: definitionVersion,
          });
          await instanceRepo.update(instanceId, {
            status: 'failed',
            error: message,
            updatedAt: new Date().toISOString(),
          });
        } catch {
          // Ignore secondary error
        }
      } finally {
        releaseRunLock(instanceId);
      }
    });

    return NextResponse.json(
      { instanceId, status: 'running', message: 'Auto-runner started' },
      { status: 202 },
    );
  } catch (err) {
    if (runLockAcquired) {
      releaseRunLock(instanceId);
    }
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error(`[auto-runner] Validation error for instance '${instanceId}': ${message}`);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
