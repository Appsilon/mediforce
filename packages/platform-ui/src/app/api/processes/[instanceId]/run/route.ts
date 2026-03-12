import { NextRequest, NextResponse } from 'next/server';
import { getPlatformServices, validateApiKey } from '@/lib/platform-services';
import { executeAgentStep } from '@/lib/execute-agent-step';

interface RunProcessBody {
  appContext?: Record<string, unknown>;
  triggeredBy?: string;
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
      initialInstance.configName,
      initialInstance.configVersion,
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
    while (true) {
      // Re-fetch instance to get current state after each advance
      const instance = await instanceRepo.getById(instanceId);
      if (!instance) {
        break;
      }

      // Stop if instance left running state
      if (instance.status !== 'running') {
        break;
      }

      // Stop if no current step (workflow completed)
      if (instance.currentStepId === null) {
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
      if (stepConfig.executorType === 'agent') {
        console.log(`[auto-runner] Executing agent step '${instance.currentStepId}' on instance '${instanceId}' (iteration ${stepsExecuted})`);

        const executionId = crypto.randomUUID();
        await instanceRepo.addStepExecution(instanceId, {
          id: executionId,
          instanceId,
          stepId: instance.currentStepId,
          status: 'running',
          input: appContext,
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
        await executeAgentStep(
          instanceId,
          instance.currentStepId,
          appContext,
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
