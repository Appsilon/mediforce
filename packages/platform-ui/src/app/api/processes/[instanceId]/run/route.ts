import { NextRequest, NextResponse, after } from 'next/server';
import { getPlatformServices } from '@/lib/platform-services';
import { resolveCallerIdentity, requireNamespaceAccess } from '@/lib/api-auth';
import { executeAgentStep } from '@/lib/execute-agent-step';
import { flattenResolvedMcpToLegacy, resolveMcpForStep, validateWorkflowEnv } from '@mediforce/agent-runtime';
import { validateActionSecrets } from '@mediforce/core-actions';
import { getWorkflowSecretsForRuntime } from '@/app/actions/workflow-secrets';
import { getNamespaceSecretsForRuntime } from '@/app/actions/namespace-secrets';
import { isStuckLoop, createLoopTracker, MAX_SAME_STEP_ITERATIONS } from '@/lib/loop-guard';

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
      const allMissing = [
        ...missingEnv,
        ...missingActionSecrets.map((m) => ({ ...m, template: `\${secrets.${m.secretName}}` })),
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
          (s) => s.executor === 'agent' || s.executor === 'script',
        ).length;
        await auditRepo.append({
          actorId: 'auto-runner',
          actorType: 'system',
          actorRole: 'orchestrator',
          action: 'process.run.started',
          description: `Auto-runner started for '${initialInstance.definitionName}' (workflow) — ${agentStepCount} agent step(s) to execute`,
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
            console.error(`[auto-runner] Safety guard: step '${instance.currentStepId}' looped ${MAX_SAME_STEP_ITERATIONS} times — aborting instance ${instanceId}`);
            await instanceRepo.update(instanceId, {
              status: 'failed',
              error: `Auto-runner stuck: step '${instance.currentStepId}' looped ${MAX_SAME_STEP_ITERATIONS} times`,
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
          const { humanTaskRepo } = getPlatformServices();
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
              outputSchema: currentStep.cowork?.outputSchema ?? null,
              voiceConfig,
              artifact: null,
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

            await humanTaskRepo.create({
              id: taskId,
              processInstanceId: instanceId,
              stepId: instance.currentStepId,
              assignedRole: currentStep.allowedRoles?.[0] ?? 'unassigned',
              assignedUserId: null,
              status: 'pending',
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
              inputSnapshot: { taskId, stepId: instance.currentStepId, reason: 'human_executor', assignedRole: currentStep.allowedRoles?.[0] ?? 'unassigned' },
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
                sources: {
                  triggerPayload: (instance.triggerPayload as Record<string, unknown>) ?? {},
                  steps: instance.variables,
                  variables: instance.variables,
                  secrets: workflowSecrets,
                },
              });

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
            const priorExecutionsForStep = (await instanceRepo.getStepExecutions(instanceId))
              .filter((e) => e.stepId === instance.currentStepId).length;
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
            await executeAgentStep(
              instanceId,
              instance.currentStepId,
              currentStep,
              mergedAppContext,
              triggeredBy ?? 'auto-runner',
              executionId,
            );

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
