import {
  AgentOutputEnvelopeSchema,
  DEFAULT_MODEL,
  DEFAULT_STEP_TIMEOUT_MINUTES,
  normaliseModelId,
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
import type {
  AgentOutputGate,
  StepExecutorPlugin,
  AgentContext,
  WorkflowAgentContext,
} from '../interfaces/step-executor-plugin';
import type { AgentEventLog } from './agent-event-log';
import { FallbackHandler } from './fallback-handler';
import { PluginRunner } from './plugin-runner';
import { repairOutput, validateOutputSchema, type OutputRepair } from './output-schema';
import { TrajectoryRecorder } from './trajectory-recorder';
import {
  annotateAgentRunSpan,
  withAgentRunSpan,
  agentRunSpanTrace,
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
  /** Set when an LLM call reshaped `result` to match `outputSchema`. */
  reshape: OutputReshape | null;
}

/** Who reshaped a result to match `outputSchema`, and what the agent had returned. */
interface OutputReshape {
  by: string;
  originalResult: Record<string, unknown> | null;
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
        trace: agentRunSpanTrace(span),
      });
    }
  }

  /**
   * Run an agent plugin using the unified WorkflowDefinition model.
   * Config is read from step.agent (model, outputSchema)
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
          trace: agentRunSpanTrace(span),
        });
      }

      const timeoutMs = resolveStepTimeoutMinutes(context.step) * 60_000;
      const trajectory = this.agentTrajectoryRepository === undefined
        ? undefined
        : new TrajectoryRecorder(this.agentTrajectoryRepository, runId);
      const runContext: WorkflowAgentContext = trajectory === undefined ? context : { ...context, trajectory };
      const outputSchema = context.step.agent?.outputSchema;
      let attempt: AttemptOutcome = await this.runAttempt(plugin, runContext, timeoutMs, outputSchema);

      if (attempt.outputSchemaViolation !== null && attempt.envelope !== null && outputSchema !== undefined) {
        attempt = await this.repairAttempt(runContext, attempt, attempt.envelope, outputSchema, attempt.outputSchemaViolation, timeoutMs - (Date.now() - startedAt));
      }
      await trajectory?.flush();

      if (
        context.outputGate !== undefined
        && attempt.envelope !== null
        && attempt.fallbackReason === null
      ) {
        const gateFailure = await this.runOutputGate(context.outputGate, runId, context, attempt.envelope);
        if (gateFailure !== null) {
          attempt = { ...attempt, fallbackReason: 'production_evaluator', errorMessage: gateFailure };
        }
      }

      const { envelope, fallbackReason, errorMessage, reshape } = attempt;

      if (fallbackReason) {
        const fallbackResult = await this.fallbackHandler.escalate(fallbackReason, processInstanceId, envelope);
        const duration_ms = Date.now() - startedAt;
        await this.appendAuditEventFromWorkflowStep(context, envelope, fallbackResult.status, duration_ms, errorMessage, reshape);
        await this.recordTerminalRun(
          span, runId, context, startedAt, { ...fallbackResult, errorMessage },
          fallbackResult.envelope?.model ?? envelope?.model ?? null,
        );
        return { ...fallbackResult, errorMessage, agentRunId: runId };
      }

      const result = await this.applyAutonomyBehaviorForWorkflowStep(autonomyLevel, envelope!, context);
      const duration_ms = Date.now() - startedAt;
      await this.appendAuditEventFromWorkflowStep(context, envelope!, result.status, duration_ms, null, reshape);
      await this.recordTerminalRun(
        span, runId, context, startedAt, result,
        result.envelope?.model ?? envelope!.model,
      );
      return { ...result, agentRunId: runId };
    });
  }

  /**
   * Hands a result that passed `outputSchema` to the step's output gate
   * (ADR-0023 D13). Returns why it failed, or null. A gate that cannot run —
   * or a check inside it that cannot — is recorded, never a failure.
   */
  private async runOutputGate(
    gate: AgentOutputGate,
    agentRunId: string,
    context: WorkflowAgentContext,
    envelope: AgentOutputEnvelope,
  ): Promise<string | null> {
    const { processInstanceId, stepId } = context;
    const status = (payload: string) => this.eventLog.write(processInstanceId, stepId, {
      type: 'status',
      payload,
      timestamp: new Date().toISOString(),
    });
    try {
      const verdict = await gate({ agentRunId, context, envelope });
      for (const error of verdict.errors) await status(`production Evaluator could not run: ${error}`);
      if (verdict.failure !== null) await status(`result failed a production Evaluator — ${verdict.failure}`);
      return verdict.failure;
    } catch (err) {
      await status(`production Evaluators could not run: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }
  }

  /**
   * Reshapes a result that broke `outputSchema` with one LLM call on the
   * step's model, inside what is left of the step timeout (ADR-0023 D13).
   * The agent is not rerun. A reshaped result keeps the original in an
   * annotation; one that still breaks the schema escalates naming both.
   */
  private async repairAttempt(
    context: WorkflowAgentContext,
    attempt: AttemptOutcome,
    envelope: AgentOutputEnvelope,
    outputSchema: OutputSchemaShape,
    violation: string,
    budgetMs: number,
  ): Promise<AttemptOutcome> {
    const { processInstanceId, stepId } = context;
    const status = (payload: string) => this.eventLog.write(processInstanceId, stepId, {
      type: 'status',
      payload,
      timestamp: new Date().toISOString(),
    });
    const rejected = attempt.errorMessage;

    if (budgetMs <= 0) {
      await status(`${rejected} — no time left in the step timeout to reshape it`);
      return attempt;
    }
    await status(`${rejected} — reshaping the result to match it`);
    const model = normaliseModelId(context.step.agent?.model ?? DEFAULT_MODEL);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const outOfTime = new Promise<OutputRepair>((resolve) => {
      timer = setTimeout(() => resolve({ ok: false, reason: 'the step timeout ran out' }), budgetMs);
    });
    const repair = await Promise.race([
      repairOutput(context.llm, model, envelope.result ?? {}, outputSchema, violation),
      outOfTime,
    ]).finally(() => clearTimeout(timer));

    if (repair.ok === false) {
      await status(`reshaping the result did not fix it: ${repair.reason}`);
      return { ...attempt, errorMessage: `${rejected} (reshaping it did not fix it: ${repair.reason})` };
    }
    await status(`result reshaped by ${repair.model} to match agent.outputSchema`);
    const annotation = {
      id: randomUUID(),
      content: `Result reshaped by ${repair.model} to match agent.outputSchema (${violation}). `
        + `The agent's original result: ${JSON.stringify(envelope.result)}`,
      timestamp: new Date().toISOString(),
    };
    return {
      envelope: { ...envelope, result: repair.result, annotations: [...envelope.annotations, annotation] },
      fallbackReason: null,
      errorMessage: null,
      outputSchemaViolation: null,
      reshape: { by: repair.model, originalResult: envelope.result },
    };
  }

  /** Execute the plugin once and classify the outcome. */
  private async runAttempt(
    plugin: StepExecutorPlugin,
    context: AgentContext | WorkflowAgentContext,
    timeoutMs: number,
    outputSchema: OutputSchemaShape | undefined,
  ): Promise<AttemptOutcome> {
    const { resultPayload, timedOut, errorMessage } = await this.pluginRunner.execute(
      plugin, context, timeoutMs,
    );
    const failed = (reason: AgentFallbackReason): AttemptOutcome => ({
      envelope: null, fallbackReason: reason, errorMessage, outputSchemaViolation: null, reshape: null,
    });

    if (timedOut) return failed('timeout');
    if (errorMessage !== null || resultPayload === null) return failed('error');
    const parseResult = AgentOutputEnvelopeSchema.safeParse(resultPayload);
    if (!parseResult.success) return failed('error');
    const envelope = parseResult.data;

    const violation = outputSchema === undefined
      ? null
      : validateOutputSchema(envelope.result ?? {}, outputSchema);
    if (violation !== null) {
      return {
        envelope,
        fallbackReason: 'output_schema',
        errorMessage: `result does not match agent.outputSchema: ${violation}`,
        outputSchemaViolation: violation,
        reshape: null,
      };
    }

    return { envelope, fallbackReason: null, errorMessage: null, outputSchemaViolation: null, reshape: null };
  }

  /**
   * Reap a stranded agent step whose driver died mid-run (ADR-0010).
   *
   * Produces the SAME `AgentRunResult` the live `Promise.race` timeout path
   * produces — `fallbackReason='timeout'` escalated through the `FallbackHandler`
   * — but WITHOUT running the plugin (it is
   * already gone). Any orphaned still-`running` Agent Run row for this step is
   * transitioned to the fallback's terminal status so it no longer shows as
   * running forever. Downstream `AgentStepExecutor` handling (L3 review routing,
   * escalation audit, instance state) is identical to a live timeout.
   */
  async reapAsTimeout(context: WorkflowAgentContext): Promise<AgentRunResult> {
    const { processInstanceId, stepId } = context;
    const errorMessage =
      'Step timed out — stranded past its timeout after its driver stopped';

    const fallbackResult = await this.fallbackHandler.escalate('timeout', processInstanceId, null);

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

    const timeoutMs = (stepConfig.timeoutMinutes ?? DEFAULT_STEP_TIMEOUT_MINUTES) * 60_000;
    const { envelope, fallbackReason, errorMessage } = await this.runAttempt(plugin, context, timeoutMs, undefined);

    if (fallbackReason) {
      const fallbackResult = await this.fallbackHandler.escalate(fallbackReason, processInstanceId, envelope);
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
        // A timeout or error still escalates through the fallback handler above.
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
    reshape: OutputReshape | null = null,
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
        ...(reshape !== null ? { reshapedBy: reshape.by, originalResult: reshape.originalResult } : {}),
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
