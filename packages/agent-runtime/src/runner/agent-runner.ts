import {
  AgentOutputEnvelopeSchema,
  resolveStepTimeoutMinutes,
  type AgentFallbackReason,
  type AgentOutputEnvelope,
  type AgentRunStatus,
  type ProcessInstanceRepository,
  type AuditRepository,
  type StepConfig,
  type AgentRunRepository,
  type AgentTrajectoryRepository,
  type OutputSchemaShape,
  type WorkflowStep,
} from '@mediforce/platform-core';
import { randomUUID } from 'crypto';
import type { Span } from '@opentelemetry/api';
import type { StepExecutorPlugin, AgentContext, WorkflowAgentContext } from '../interfaces/step-executor-plugin';
import type { AgentEventLog } from './agent-event-log';
import { FallbackHandler } from './fallback-handler';
import { PluginRunner } from './plugin-runner';
import { validateOutputSchema } from './output-schema';
import { TrajectoryRecorder } from './trajectory-recorder';
import {
  annotateAgentRunSpan,
  withAgentRunSpan,
  type OpenTelemetryTracingOptions,
} from './tracing';

export interface AgentRunResult {
  status: AgentRunStatus;
  envelope: AgentOutputEnvelope | null;
  appliedToWorkflow: boolean; // true only for L4; false for L0/L1/L2/L3 and fallbacks
  fallbackReason: AgentFallbackReason | null;
  errorMessage?: string | null;
  /** The Agent Run this result belongs to; absent when none was started (reap). */
  agentRunId?: string;
}

/** What one plugin execution produced, before fallback and autonomy apply. */
interface AttemptOutcome {
  envelope: AgentOutputEnvelope | null;
  fallbackReason: AgentFallbackReason | null;
  errorMessage: string | null;
  /** The `validateOutputSchema` message when `fallbackReason` is `output_schema`. */
  outputSchemaViolation: string | null;
}

/** What a result must satisfy to be accepted without a fallback. */
interface AttemptChecks {
  outputSchema: OutputSchemaShape | undefined;
  confidenceThreshold: number;
}

export class AgentRunner {
  private readonly fallbackHandler: FallbackHandler;
  private readonly pluginRunner: PluginRunner;

  constructor(
    private readonly instanceRepository: ProcessInstanceRepository,
    private readonly auditRepository: AuditRepository,
    private readonly eventLog: AgentEventLog,
    private readonly agentRunRepository?: AgentRunRepository,
    private readonly tracingOptions: OpenTelemetryTracingOptions = {},
    private readonly agentTrajectoryRepository?: AgentTrajectoryRepository,
  ) {
    this.fallbackHandler = new FallbackHandler(instanceRepository);
    this.pluginRunner = new PluginRunner(eventLog);
  }

  /** Annotate the span and persist the terminal Agent Run record (upsert on runId). */
  private async recordTerminalRun(
    span: Span,
    runId: string,
    context: WorkflowAgentContext,
    startedAt: number,
    result: AgentRunResult,
    envelopeModel: string | null,
  ): Promise<void> {
    annotateAgentRunSpan(span, {
      status: result.status,
      appliedToWorkflow: result.appliedToWorkflow,
      fallbackReason: result.fallbackReason,
      envelopeModel,
      capturedResult:
        this.tracingOptions.captureContent === true ? result.envelope?.result : undefined,
    });
    if (this.agentRunRepository) {
      // In-flight cancel guard: if cancelRun reaped this AgentRun to a terminal
      // state (e.g. `error`) while the plugin was still executing, do NOT
      // resurrect it with the real completion result. Only terminalize a row
      // that is still `running`.
      const existing = await this.agentRunRepository.getById(runId);
      if (existing && existing.status !== 'running') {
        return;
      }
      await this.agentRunRepository.create({
        id: runId,
        processInstanceId: context.processInstanceId,
        stepId: context.stepId,
        pluginId: context.step.plugin ?? context.stepId,
        autonomyLevel: context.autonomyLevel as 'L0' | 'L1' | 'L2' | 'L3' | 'L4',
        status: result.status,
        envelope: result.envelope,
        fallbackReason: result.fallbackReason,
        startedAt: new Date(startedAt).toISOString(),
        completedAt: new Date().toISOString(),
      });
    }
  }

  /**
   * Run an agent plugin using the unified WorkflowDefinition model.
   * Config is read from step.agent (model, confidenceThreshold, fallbackBehavior)
   * or step.script / step.databricks (deterministic plugins), plus
   * step.autonomyLevel / step.plugin; timeout via resolveStepTimeoutMinutes.
   */
  async runWithWorkflowStep(
    plugin: StepExecutorPlugin,
    context: WorkflowAgentContext,
  ): Promise<AgentRunResult> {
    const startedAt = Date.now();
    const { processInstanceId, stepId, autonomyLevel } = context;
    const runId = randomUUID();
    const pluginId = context.step.plugin ?? context.stepId;

    return withAgentRunSpan(runId, context, this.tracingOptions, async (span) => {
      if (this.agentRunRepository) {
        await this.agentRunRepository.create({
          id: runId,
          processInstanceId,
          stepId,
          pluginId,
          autonomyLevel: autonomyLevel as 'L0' | 'L1' | 'L2' | 'L3' | 'L4',
          status: 'running',
          envelope: null,
          fallbackReason: null,
          startedAt: new Date(startedAt).toISOString(),
          completedAt: null,
        });
      }

      const timeoutMs = resolveStepTimeoutMinutes(context.step) * 60_000;
      const trajectory = this.agentTrajectoryRepository === undefined
        ? undefined
        : new TrajectoryRecorder(this.agentTrajectoryRepository, runId);
      const runContext: WorkflowAgentContext = trajectory === undefined ? context : { ...context, trajectory };
      const checks: AttemptChecks = {
        outputSchema: context.step.agent?.outputSchema,
        confidenceThreshold: context.step.agent?.confidenceThreshold ?? 0,
      };
      let attempt = await this.runAttempt(plugin, runContext, timeoutMs, checks);

      if (attempt.outputSchemaViolation !== null) {
        // Both attempts share one step timeout: the run route's reap guard
        // measures a step execution from its start against a single timeout.
        const retryBudgetMs = timeoutMs - (Date.now() - startedAt);
        if (retryBudgetMs > 0) {
          await this.eventLog.write(processInstanceId, stepId, {
            type: 'status',
            payload: `result does not match agent.outputSchema (${attempt.outputSchemaViolation}) — retrying once with the validation error`,
            timestamp: new Date().toISOString(),
          });
          // A retry is fresh activity: keep the heartbeat's stranded sweep from
          // reading the longer step as a dead driver.
          await this.instanceRepository.update(processInstanceId, { updatedAt: new Date().toISOString() });
          attempt = await this.runAttempt(
            plugin,
            { ...runContext, outputSchemaViolation: attempt.outputSchemaViolation },
            retryBudgetMs,
            checks,
          );
        } else {
          await this.eventLog.write(processInstanceId, stepId, {
            type: 'status',
            payload: `result does not match agent.outputSchema (${attempt.outputSchemaViolation}) — no time left in the step timeout to retry`,
            timestamp: new Date().toISOString(),
          });
        }
      }
      await trajectory?.flush();

      const { envelope, fallbackReason, errorMessage } = attempt;

      if (fallbackReason) {
        const partialWork = this.eventLog.getPartialWork(processInstanceId, stepId);
        const fallbackResult = await this.fallbackHandler.handleWithWorkflowStep(
          fallbackReason,
          context,
          partialWork,
          envelope,
        );
        const duration_ms = Date.now() - startedAt;
        await this.appendAuditEventFromWorkflowStep(context, envelope, fallbackResult.status, duration_ms, errorMessage);
        await this.recordTerminalRun(
          span, runId, context, startedAt, { ...fallbackResult, errorMessage },
          fallbackResult.envelope?.model ?? envelope?.model ?? null,
        );
        return { ...fallbackResult, errorMessage, agentRunId: runId };
      }

      const result = await this.applyAutonomyBehaviorForWorkflowStep(autonomyLevel, envelope!, context);
      const duration_ms = Date.now() - startedAt;
      await this.appendAuditEventFromWorkflowStep(context, envelope!, result.status, duration_ms);
      await this.recordTerminalRun(
        span, runId, context, startedAt, result,
        result.envelope?.model ?? envelope!.model,
      );
      return { ...result, agentRunId: runId };
    });
  }

  /** Execute the plugin once and classify the outcome. The output-schema check
   *  runs before the confidence check: a malformed result is not trusted for
   *  its self-assessed confidence either. */
  private async runAttempt(
    plugin: StepExecutorPlugin,
    context: AgentContext | WorkflowAgentContext,
    timeoutMs: number,
    checks: AttemptChecks,
  ): Promise<AttemptOutcome> {
    const { resultPayload, timedOut, errorMessage } = await this.pluginRunner.execute(
      plugin, context, timeoutMs,
    );
    const failed = (reason: AgentFallbackReason): AttemptOutcome => ({
      envelope: null, fallbackReason: reason, errorMessage, outputSchemaViolation: null,
    });

    if (timedOut) return failed('timeout');
    if (errorMessage !== null || resultPayload === null) return failed('error');
    const parseResult = AgentOutputEnvelopeSchema.safeParse(resultPayload);
    if (!parseResult.success) return failed('error');
    const envelope = parseResult.data;

    const violation = checks.outputSchema === undefined
      ? null
      : validateOutputSchema(envelope.result ?? {}, checks.outputSchema);
    if (violation !== null) {
      return {
        envelope,
        fallbackReason: 'output_schema',
        errorMessage: `result does not match agent.outputSchema: ${violation}`,
        outputSchemaViolation: violation,
      };
    }

    return {
      envelope,
      fallbackReason: envelope.confidence < checks.confidenceThreshold ? 'low_confidence' : null,
      errorMessage: null,
      outputSchemaViolation: null,
    };
  }

  /**
   * Reap a stranded agent step whose driver died mid-run (ADR-0010).
   *
   * Produces the SAME `AgentRunResult` the live `Promise.race` timeout path
   * produces — `fallbackReason='timeout'` routed through the `FallbackHandler`
   * per the step's `fallbackBehavior` — but WITHOUT running the plugin (it is
   * already gone). Any orphaned still-`running` Agent Run row for this step is
   * transitioned to the fallback's terminal status so it no longer shows as
   * running forever. Downstream `AgentStepExecutor` handling (L3 review routing,
   * escalation audit, instance state) is identical to a live timeout.
   */
  async reapAsTimeout(context: WorkflowAgentContext): Promise<AgentRunResult> {
    const { processInstanceId, stepId } = context;
    const errorMessage =
      'Step timed out — stranded past its timeout after its driver stopped';

    const fallbackResult = await this.fallbackHandler.handleWithWorkflowStep(
      'timeout', context, [], null,
    );

    let reapedRunId: string | undefined;
    if (this.agentRunRepository) {
      const orphaned = (await this.agentRunRepository.getByInstanceId(processInstanceId))
        .filter((run) => run.stepId === stepId && run.status === 'running');
      reapedRunId = orphaned[0]?.id;
      for (const run of orphaned) {
        // create() upserts on runId — recreating with the same id terminates
        // the orphaned row rather than inserting a duplicate.
        await this.agentRunRepository.create({
          ...run,
          status: fallbackResult.status,
          fallbackReason: 'timeout',
          completedAt: new Date().toISOString(),
        });
      }
    }

    await this.appendAuditEventFromWorkflowStep(
      context, null, fallbackResult.status, 0, errorMessage,
    );
    return { ...fallbackResult, errorMessage, agentRunId: reapedRunId };
  }

  /**
   * Terminalize the AgentRun row(s) a deploy-interrupted step left `running`
   * (ADR-0010 §4). When the auto-runner retries an `interrupted` step it spawns a
   * fresh AgentRun; without this, the original — created by `runWithWorkflowStep`
   * before the process was recycled — would sit `running` in the Agents history
   * forever (the SIGTERM hook only touches the `StepExecution`). Mirrors the
   * orphan cleanup in {@link reapAsTimeout}, but marks them `interrupted` (they
   * were interrupted, not timed out). Returns how many rows were terminalized.
   */
  async markStepRunsInterrupted(processInstanceId: string, stepId: string): Promise<number> {
    if (!this.agentRunRepository) return 0;
    const orphaned = (await this.agentRunRepository.getByInstanceId(processInstanceId))
      .filter((run) => run.stepId === stepId && run.status === 'running');
    for (const run of orphaned) {
      // create() upserts on runId — recreating with the same id terminalizes the
      // orphaned row rather than inserting a duplicate.
      await this.agentRunRepository.create({
        ...run,
        status: 'interrupted',
        completedAt: new Date().toISOString(),
      });
    }
    return orphaned.length;
  }

  /**
   * @deprecated Use runWithWorkflowStep instead. This method relies on the legacy
   * StepConfig model which is being replaced by WorkflowStep.
   */
  async run(
    plugin: StepExecutorPlugin,
    context: AgentContext,
    stepConfig: StepConfig,
  ): Promise<AgentRunResult> {
    const startedAt = Date.now();
    const { processInstanceId, stepId, autonomyLevel } = context;
    const runId = randomUUID();
    const pluginId = stepConfig.plugin ?? context.stepId;

    if (this.agentRunRepository) {
      await this.agentRunRepository.create({
        id: runId,
        processInstanceId,
        stepId,
        pluginId,
        autonomyLevel: autonomyLevel as 'L0' | 'L1' | 'L2' | 'L3' | 'L4',
        status: 'running',
        envelope: null,
        fallbackReason: null,
        startedAt: new Date(startedAt).toISOString(),
        completedAt: null,
      });
    }

    const timeoutMs = (stepConfig.timeoutMinutes ?? 30) * 60_000;
    const { envelope, fallbackReason, errorMessage } = await this.runAttempt(plugin, context, timeoutMs, {
      outputSchema: undefined,
      confidenceThreshold: stepConfig.confidenceThreshold ?? 0,
    });

    if (fallbackReason) {
      const partialWork = this.eventLog.getPartialWork(processInstanceId, stepId);
      const fallbackResult = await this.fallbackHandler.handle(
        fallbackReason,
        context,
        stepConfig,
        partialWork,
        envelope,
      );
      const duration_ms = Date.now() - startedAt;
      await this.appendAuditEvent(context, stepConfig, envelope, fallbackResult.status, duration_ms, errorMessage);
      if (this.agentRunRepository) {
        await this.agentRunRepository.create({
          id: runId,
          processInstanceId,
          stepId,
          pluginId,
          autonomyLevel: autonomyLevel as 'L0' | 'L1' | 'L2' | 'L3' | 'L4',
          status: fallbackResult.status,
          envelope: fallbackResult.envelope,
          fallbackReason: fallbackResult.fallbackReason,
          startedAt: new Date(startedAt).toISOString(),
          completedAt: new Date().toISOString(),
        });
      }
      return { ...fallbackResult, errorMessage };
    }

    const result = await this.applyAutonomyBehavior(autonomyLevel, envelope!, context);
    const duration_ms = Date.now() - startedAt;
    await this.appendAuditEvent(context, stepConfig, envelope!, result.status, duration_ms);
    if (this.agentRunRepository) {
      await this.agentRunRepository.create({
        id: runId,
        processInstanceId,
        stepId,
        pluginId,
        autonomyLevel: autonomyLevel as 'L0' | 'L1' | 'L2' | 'L3' | 'L4',
        status: result.status,
        envelope: result.envelope,
        fallbackReason: result.fallbackReason,
        startedAt: new Date(startedAt).toISOString(),
        completedAt: new Date().toISOString(),
      });
    }
    return result;
  }

  private async applyAutonomyBehaviorForWorkflowStep(
    level: string,
    envelope: AgentOutputEnvelope,
    context: WorkflowAgentContext,
  ): Promise<AgentRunResult> {
    const { processInstanceId, stepId } = context;

    switch (level) {
      case 'L0':
        return { status: 'completed', envelope, appliedToWorkflow: false, fallbackReason: null };

      case 'L1':
        await this.eventLog.write(processInstanceId, stepId, {
          type: 'shadow_result',
          payload: envelope,
          timestamp: new Date().toISOString(),
        });
        return { status: 'completed', envelope, appliedToWorkflow: false, fallbackReason: null };

      case 'L2':
        return { status: 'completed', envelope, appliedToWorkflow: false, fallbackReason: null };

      case 'L3': {
        // review.type='agent' means the agent is the authoritative decider — do
        // not pause for human approval. The executor inspects step.type to pick
        // the right engine path: submitReviewVerdict (iteration loop with
        // maxIterations enforcement) for review steps, or advanceStep for others.
        // Low-confidence or timeout still routes through the fallback handler above.
        if (context.step.review?.type === 'agent') {
          return { status: 'completed', envelope, appliedToWorkflow: true, fallbackReason: null };
        }
        await this.instanceRepository.update(context.processInstanceId, {
          status: 'paused',
          pauseReason: 'awaiting_agent_approval',
        });
        return { status: 'paused', envelope, appliedToWorkflow: false, fallbackReason: null };
      }

      case 'L4':
        return { status: 'completed', envelope, appliedToWorkflow: true, fallbackReason: null };

      default:
        return { status: 'completed', envelope, appliedToWorkflow: false, fallbackReason: null };
    }
  }

  private async appendAuditEventFromWorkflowStep(
    context: WorkflowAgentContext,
    envelope: AgentOutputEnvelope | null,
    runStatus: AgentRunStatus,
    duration_ms: number,
    errorMessage: string | null = null,
  ): Promise<void> {
    const pluginId = context.step.plugin ?? context.stepId;
    const isScript = context.step.executor === 'script';
    const reviewerType = context.autonomyLevel === 'L4'
      ? 'none'
      : context.autonomyLevel === 'L3'
        ? (context.step.review?.type ?? 'human')
        : 'none';

    await this.auditRepository.append({
      actorId: `${isScript ? 'script' : 'agent'}:${pluginId}`,
      actorType: isScript ? 'system' : 'agent',
      actorRole: context.autonomyLevel,
      action: isScript ? 'script.run' : 'agent.run',
      description: isScript
        ? `Script completed with status '${runStatus}'`
        : `Agent run completed with status '${runStatus}' at autonomy level ${context.autonomyLevel}`,
      timestamp: new Date().toISOString(),
      inputSnapshot: {
        stepInput: context.stepInput,
        ...(isScript ? {} : { autonomyLevel: context.autonomyLevel }),
        model: context.step.agent?.model ?? envelope?.model ?? null,
      },
      outputSnapshot: {
        status: runStatus,
        confidence: envelope?.confidence ?? null,
        model: envelope?.model ?? null,
        duration_ms,
        reasoning_summary: envelope?.reasoning_summary ?? null,
        result: envelope?.result ?? null,
        ...(errorMessage !== null ? { error: errorMessage } : {}),
      },
      basis: isScript
        ? 'Deterministic script execution'
        : `Autonomy level ${context.autonomyLevel} — ${this.getBasisDescription(context.autonomyLevel)}`,
      entityType: 'process_instance',
      entityId: context.processInstanceId,
      processInstanceId: context.processInstanceId,
      stepId: context.stepId,
      processDefinitionVersion: context.definitionVersion,
      executorType: isScript ? 'script' : 'agent',
      reviewerType,
    });
  }

  private async applyAutonomyBehavior(
    level: string,
    envelope: AgentOutputEnvelope,
    context: AgentContext,
  ): Promise<AgentRunResult> {
    const { processInstanceId, stepId } = context;

    switch (level) {
      case 'L0':
        // Silent Observer — run completes but output not surfaced
        return {
          status: 'completed',
          envelope,
          appliedToWorkflow: false,
          fallbackReason: null,
        };

      case 'L1':
        // Shadow — emit shadow_result event to event log
        await this.eventLog.write(processInstanceId, stepId, {
          type: 'shadow_result',
          payload: envelope,
          timestamp: new Date().toISOString(),
        });
        return {
          status: 'completed',
          envelope,
          appliedToWorkflow: false,
          fallbackReason: null,
        };

      case 'L2':
        // Annotator — annotations already in event log from plugin emissions
        return {
          status: 'completed',
          envelope,
          appliedToWorkflow: false,
          fallbackReason: null,
        };

      case 'L3':
        // Advisor — pause instance awaiting approval
        await this.instanceRepository.update(context.processInstanceId, {
          status: 'paused',
          pauseReason: 'awaiting_agent_approval',
        });
        return {
          status: 'paused',
          envelope,
          appliedToWorkflow: false,
          fallbackReason: null,
        };

      case 'L4':
        // Autopilot — result applied directly to workflow
        return {
          status: 'completed',
          envelope,
          appliedToWorkflow: true,
          fallbackReason: null,
        };

      default:
        // Unknown autonomy level — treat as L0 (safe default)
        return {
          status: 'completed',
          envelope,
          appliedToWorkflow: false,
          fallbackReason: null,
        };
    }
  }

  private async appendAuditEvent(
    context: AgentContext,
    stepConfig: StepConfig,
    envelope: AgentOutputEnvelope | null,
    runStatus: AgentRunStatus,
    duration_ms: number,
    errorMessage: string | null = null,
  ): Promise<void> {
    const reviewerType = context.autonomyLevel === 'L4'
      ? 'none'
      : context.autonomyLevel === 'L3'
        ? (stepConfig.reviewerType ?? 'human')
        : 'none';

    await this.auditRepository.append({
      actorId: `agent:${stepConfig.plugin ?? context.stepId}`,
      actorType: 'agent',
      actorRole: context.autonomyLevel,
      action: 'agent.run',
      description: `Agent run completed with status '${runStatus}' at autonomy level ${context.autonomyLevel}`,
      timestamp: new Date().toISOString(),
      inputSnapshot: {
        stepInput: context.stepInput,
        autonomyLevel: context.autonomyLevel,
        model: stepConfig.model ?? envelope?.model ?? null,
      },
      outputSnapshot: {
        status: runStatus,
        confidence: envelope?.confidence ?? null,
        model: envelope?.model ?? null,
        duration_ms,
        reasoning_summary: envelope?.reasoning_summary ?? null,
        result: envelope?.result ?? null,
        ...(errorMessage !== null ? { error: errorMessage } : {}),
      },
      basis: `Autonomy level ${context.autonomyLevel} — ${this.getBasisDescription(context.autonomyLevel)}`,
      entityType: 'process_instance',
      entityId: context.processInstanceId,
      processInstanceId: context.processInstanceId,
      stepId: context.stepId,
      processDefinitionVersion: context.definitionVersion,
      executorType: 'agent',
      reviewerType,
    });
  }

  private getBasisDescription(level: string): string {
    const descriptions: Record<string, string> = {
      L0: 'Silent observer — output not surfaced to workflow',
      L1: 'Shadow mode — result stored for comparison only',
      L2: 'Annotator — annotations provided for human review',
      L3: 'Advisor — recommendation requires human approval',
      L4: 'Autopilot — result applied directly to workflow',
    };
    return descriptions[level] ?? 'Unknown autonomy level';
  }
}
