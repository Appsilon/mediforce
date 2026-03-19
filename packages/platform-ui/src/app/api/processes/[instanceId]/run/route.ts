import { NextRequest, NextResponse } from 'next/server';
import { getPlatformServices, validateApiKey } from '@/lib/platform-services';
import { executeAgentStep } from '@/lib/execute-agent-step';
import { executeWorkflowAgentStep } from '@/lib/execute-workflow-agent-step';

interface RunProcessBody {
  appContext?: Record<string, unknown>;
  triggeredBy?: string;
}

const MAX_SAME_STEP_ITERATIONS = 3;

/** Tracks consecutive re-executions of the same step. Returns true if stuck. */
function isStuckLoop(
  currentStepId: string | null,
  tracker: { previousStepId: string | null; count: number },
): boolean {
  if (currentStepId === tracker.previousStepId) {
    tracker.count++;
    return tracker.count >= MAX_SAME_STEP_ITERATIONS;
  }
  tracker.count = 0;
  tracker.previousStepId = currentStepId;
  return false;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ instanceId: string }> },
): Promise<NextResponse> {
  if (!validateApiKey(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { instanceId } = await params;
  const { instanceRepo, processRepo, auditRepo } = getPlatformServices();
  let stepsExecuted = 0;
  let definitionVersion = 'unknown';

  try {
    const body = (await req.json().catch(() => ({}))) as RunProcessBody;

    // Load instance
    const initialInstance = await instanceRepo.getById(instanceId);
    if (!initialInstance) {
      return NextResponse.json({ error: 'Instance not found' }, { status: 404 });
    }

    definitionVersion = initialInstance.definitionVersion;

    // Must be in running state to auto-run
    if (initialInstance.status !== 'running') {
      return NextResponse.json(
        { error: 'Instance is not in running state', status: initialInstance.status },
        { status: 409 },
      );
    }

    // Determine whether this is a new-style WorkflowDefinition instance (no configName)
    // or a legacy ProcessDefinition + ProcessConfig instance.
    const isWorkflowInstance = !initialInstance.configName;

    if (isWorkflowInstance) {
      // ---- New-style: WorkflowDefinition path ----
      const workflowDefinition = await processRepo.getWorkflowDefinition(
        initialInstance.definitionName,
        Number(initialInstance.definitionVersion),
      );
      if (!workflowDefinition) {
        return NextResponse.json(
          { error: 'WorkflowDefinition not found', definitionName: initialInstance.definitionName, version: initialInstance.definitionVersion },
          { status: 404 },
        );
      }

      const appContext: Record<string, unknown> = body.appContext
        ?? (initialInstance.triggerPayload as Record<string, unknown>)
        ?? {};
      const triggeredBy = body.triggeredBy;

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
      const loopTracker = { previousStepId: null as string | null, count: 0 };

      while (true) {
        const instance = await instanceRepo.getById(instanceId);
        if (!instance) break;
        if (instance.status !== 'running') break;
        if (instance.currentStepId === null) break;

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

        if (currentStep.executor === 'human') {
          const now = new Date().toISOString();
          const taskId = crypto.randomUUID();

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
            iterationNumber: 0,
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
          await executeWorkflowAgentStep(
            instanceId,
            instance.currentStepId,
            currentStep,
            mergedAppContext,
            triggeredBy ?? 'auto-runner',
            executionId,
          );

          stepsExecuted++;
        } else {
          await instanceRepo.update(instanceId, {
            status: 'failed',
            error: `Unknown executor '${currentStep.executor}' for step '${instance.currentStepId}'`,
            updatedAt: new Date().toISOString(),
          });
          break;
        }
      }
    } else {
      // ---- Legacy: ProcessDefinition + ProcessConfig path ----

      // Load the process definition
      const definition = await processRepo.getProcessDefinition(
        initialInstance.definitionName,
        initialInstance.definitionVersion,
      );
      if (!definition) {
        return NextResponse.json(
          { error: 'Process definition not found', definitionName: initialInstance.definitionName },
          { status: 404 },
        );
      }

      // Load ProcessConfig once before the loop (3-part key)
      const processConfig = await processRepo.getProcessConfig(
        initialInstance.definitionName,
        initialInstance.configName ?? '',
        initialInstance.configVersion ?? '',
      );
      if (!processConfig) {
        return NextResponse.json(
          { error: 'ProcessConfig not found', configKey: `${initialInstance.definitionName}:${initialInstance.configName}:${initialInstance.configVersion}` },
          { status: 404 },
        );
      }

      // Resolve appContext from body or trigger payload (entire payload becomes context)
      const appContext: Record<string, unknown> = body.appContext
        ?? (initialInstance.triggerPayload as Record<string, unknown>)
        ?? {};
      const triggeredBy = body.triggeredBy;

      const agentStepCount = processConfig.stepConfigs.filter(
        (sc) => sc.executorType === 'agent',
      ).length;
      await auditRepo.append({
        actorId: 'auto-runner',
        actorType: 'system',
        actorRole: 'orchestrator',
        action: 'process.run.started',
        description: `Auto-runner started for '${initialInstance.definitionName}' — ${agentStepCount} agent step(s) to execute`,
        timestamp: new Date().toISOString(),
        inputSnapshot: { definitionName: initialInstance.definitionName, definitionVersion: initialInstance.definitionVersion, appContext, triggeredBy: triggeredBy ?? 'auto-runner' },
        outputSnapshot: {},
        basis: 'Auto-run triggered after process start',
        entityType: 'processInstance',
        entityId: instanceId,
        processInstanceId: instanceId,
        processDefinitionVersion: initialInstance.definitionVersion,
      });

      // Execution loop — iterate until paused, completed, failed, or terminal step reached
      const legacyLoopTracker = { previousStepId: null as string | null, count: 0 };

      while (true) {
        const instance = await instanceRepo.getById(instanceId);
        if (!instance) break;
        if (instance.status !== 'running') break;
        if (instance.currentStepId === null) break;

        if (isStuckLoop(instance.currentStepId, legacyLoopTracker)) {
          console.error(`[auto-runner/legacy] Safety guard: step '${instance.currentStepId}' looped ${MAX_SAME_STEP_ITERATIONS} times — aborting instance ${instanceId}`);
          await instanceRepo.update(instanceId, {
            status: 'failed',
            error: `Auto-runner stuck: step '${instance.currentStepId}' looped ${MAX_SAME_STEP_ITERATIONS} times`,
            updatedAt: new Date().toISOString(),
          });
          break;
        }

        // Find the current step in the definition
        const currentStep = definition.steps.find((s) => s.id === instance.currentStepId);
        if (!currentStep) {
          // Unknown step — fail safe
          await instanceRepo.update(instanceId, {
            status: 'failed',
            error: `Unknown step: ${instance.currentStepId}`,
            updatedAt: new Date().toISOString(),
          });
          break;
        }

        // Terminal step — done (behavioral type check, stays the same)
        if (currentStep.type === 'terminal') {
          break;
        }

        // Look up StepConfig from ProcessConfig for executor routing
        const stepConfig = processConfig.stepConfigs.find(
          (sc) => sc.stepId === instance.currentStepId,
        );
        if (!stepConfig) {
          await instanceRepo.update(instanceId, {
            status: 'failed',
            error: `Missing StepConfig for step '${instance.currentStepId}' in ProcessConfig '${initialInstance.definitionName}:${initialInstance.configName}:${initialInstance.configVersion}'`,
            updatedAt: new Date().toISOString(),
          });
          break;
        }

        // Guard: skip if a pending/claimed task already exists for this step (prevents duplicates from race conditions)
        const { humanTaskRepo } = getPlatformServices();
        const existingTasks = await humanTaskRepo.getByInstanceId(instanceId);
        const hasPendingTask = existingTasks.some(
          (t) => t.stepId === instance.currentStepId && (t.status === 'pending' || t.status === 'claimed'),
        );
        if (hasPendingTask) {
          console.log(`[auto-runner] Duplicate guard: pending task already exists for step '${instance.currentStepId}' on instance '${instanceId}' — pausing`);
          // Ensure instance is paused so the UI shows the task correctly
          if (instance.status === 'running') {
            await instanceRepo.update(instanceId, {
              status: 'paused',
              pauseReason: 'waiting_for_human',
              updatedAt: new Date().toISOString(),
            });
          }
          break;
        }

        // Human executor — create HumanTask, pause (do NOT advanceStep — the human hasn't acted yet)
        if (stepConfig.executorType === 'human') {
          const now = new Date().toISOString();
          const taskId = crypto.randomUUID();

          await humanTaskRepo.create({
            id: taskId,
            processInstanceId: instanceId,
            stepId: instance.currentStepId,
            assignedRole: stepConfig.allowedRoles?.[0] ?? 'unassigned',
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
          });

          await auditRepo.append({
            actorId: 'auto-runner',
            actorType: 'system',
            actorRole: 'orchestrator',
            action: 'task.created',
            description: `Human task created for step '${instance.currentStepId}' (reason: human_executor)`,
            timestamp: now,
            inputSnapshot: { taskId, stepId: instance.currentStepId, reason: 'human_executor', assignedRole: stepConfig.allowedRoles?.[0] ?? 'unassigned' },
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

        // Agent executor — write running execution record then call advance
        if (stepConfig.executorType === 'agent' || stepConfig.executorType === 'script') {
          console.log(`[auto-runner] Executing agent step '${instance.currentStepId}' on instance '${instanceId}' (iteration ${stepsExecuted})`);

          // Capture semantic input: previous step's output as top-level keys
          // (backward compatible), plus a `steps` map with ALL prior step outputs
          // keyed by step ID so any step can access non-adjacent data
          // (e.g., register-definition reads steps['validate-definition'].yaml).
          const previousStepId = definition.transitions.find(
            (t) => t.to === instance.currentStepId,
          )?.from ?? null;
          const previousStepOutput = previousStepId
            ? (instance.variables[previousStepId] as Record<string, unknown>) ?? {}
            : {};
          const stepInput = { ...previousStepOutput, steps: instance.variables };

          const executionId = crypto.randomUUID();
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
            iterationNumber: 0,
            gateResult: null,
            error: null,
          });

          await auditRepo.append({
            actorId: 'auto-runner',
            actorType: 'system',
            actorRole: 'orchestrator',
            action: 'process.run.step.started',
            description: `Auto-runner dispatching step '${instance.currentStepId}'`,
            timestamp: new Date().toISOString(),
            inputSnapshot: { stepId: instance.currentStepId, appContext },
            outputSnapshot: {},
            basis: 'Auto-run loop: agent step dispatch',
            entityType: 'processInstance',
            entityId: instanceId,
            processInstanceId: instanceId,
            processDefinitionVersion: initialInstance.definitionVersion,
          });

          // Call executeAgentStep directly — no HTTP, no timeout issues.
          // No autonomyLevel arg — resolved internally from ProcessConfig.
          // Merge trigger payload with previous step's output so the plugin
          // receives semantic data from the prior step (e.g., YAML content).
          // stepInput wins over appContext for overlapping keys — it's more specific.
          const mergedAppContext = { ...appContext, ...stepInput };
          await executeAgentStep(
            instanceId,
            instance.currentStepId,
            mergedAppContext,
            triggeredBy ?? 'auto-runner',
            executionId,
          );

          stepsExecuted++;
          // Continue loop — re-fetch to get updated state
        } else {
          // Unknown executorType — fail the instance
          await instanceRepo.update(instanceId, {
            status: 'failed',
            error: `Unknown executorType '${stepConfig.executorType}' for step '${instance.currentStepId}' in ProcessConfig '${initialInstance.definitionName}:${initialInstance.configName}:${initialInstance.configVersion}'`,
            updatedAt: new Date().toISOString(),
          });
          break;
        }
      }
    }

    // Re-fetch final state for response
    const finalInstance = await instanceRepo.getById(instanceId);

    return NextResponse.json({
      instanceId,
      status: finalInstance?.status ?? 'unknown',
      currentStepId: finalInstance?.currentStepId ?? null,
      stepsExecuted,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';

    console.error(`[auto-runner] Unhandled error for instance '${instanceId}': ${message}`);

    // Attempt to mark instance as failed and write audit event
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

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
