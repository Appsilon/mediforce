import {
  DatabricksJobConfigSchema,
  interpolate,
  resolveStepTimeoutMinutes,
  type DatabricksJobConfig,
  type InterpolationSources,
  type PluginCapabilityMetadata,
} from '@mediforce/platform-core';
import type { AgentContext, StepExecutorPlugin, EmitFn, WorkflowAgentContext } from '../../interfaces/step-executor-plugin';
import { isWorkflowAgentContext } from '../container-plugin';
import { DatabricksClient, isTerminalLifecycle } from './databricks-client';

const MAX_CONSECUTIVE_POLL_FAILURES = 3;
const DEFAULT_POLL_INTERVAL_MS = 10_000;
/** Cancel margin before the AgentRunner timeout race kills the step. */
const DEADLINE_BUFFER_MS = 5_000;

export interface DatabricksJobPluginInit {
  fetchImpl?: typeof fetch;
  /** Injectable so unit tests poll without real timers. */
  sleepImpl?: (ms: number) => Promise<void>;
}

/**
 * Deterministic plugin (executor='script', plugin='databricks-job') that
 * triggers an EXISTING Databricks job via run-now, polls to terminal state,
 * and emits the JSON the notebook exits with (dbutils.notebook.exit) as the
 * step result. Job creation/deployment stays in the customer's Databricks
 * pipeline — this plugin only orchestrates runs.
 *
 * Config: step.databricks (DatabricksJobConfigSchema). Secrets (namespace or
 * workflow level): DATABRICKS_HOST, DATABRICKS_TOKEN (PAT, `jobs` API scope).
 * Errors fail the step (never a low-confidence result) — same rule as
 * ScriptContainerPlugin.
 */
export class DatabricksJobPlugin implements StepExecutorPlugin {
  readonly metadata: PluginCapabilityMetadata = {
    name: 'Databricks Job',
    description: 'Triggers an existing Databricks job via REST and waits for its result — no LLM involved.',
    inputDescription: 'step.databricks: jobId + optional notebookParams/jobParameters (values support ${steps.*} interpolation). Secrets: DATABRICKS_HOST, DATABRICKS_TOKEN.',
    outputDescription: 'JSON object the notebook exits with (dbutils.notebook.exit) as the step result; { raw } when the output is not a JSON object.',
    roles: ['executor'],
  };

  private context!: WorkflowAgentContext;
  private config!: DatabricksJobConfig;
  private client!: DatabricksClient;
  private readonly fetchImpl?: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(init: DatabricksJobPluginInit = {}) {
    this.fetchImpl = init.fetchImpl;
    this.sleep = init.sleepImpl
      ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  async initialize(context: AgentContext | WorkflowAgentContext): Promise<void> {
    if (!isWorkflowAgentContext(context)) {
      throw new Error('DatabricksJobPlugin requires the WorkflowDefinition model (legacy ProcessConfig is not supported)');
    }
    this.context = context;

    if (context.step.databricks === undefined) {
      throw new Error(
        `No databricks config found for step '${context.stepId}'. ` +
        'DatabricksJobPlugin requires step.databricks with a jobId.',
      );
    }
    this.config = DatabricksJobConfigSchema.parse(context.step.databricks);

    const host = context.workflowSecrets?.DATABRICKS_HOST;
    const token = context.workflowSecrets?.DATABRICKS_TOKEN;
    if (host === undefined || token === undefined) {
      throw new Error(
        `Databricks credentials missing for step '${context.stepId}'. ` +
        'Set DATABRICKS_HOST and DATABRICKS_TOKEN as namespace secrets ' +
        '(workspace settings → Secrets) or in the workflow\'s Secrets panel.',
      );
    }
    this.client = new DatabricksClient({ host, token, fetchImpl: this.fetchImpl });
  }

  async run(emit: EmitFn): Promise<void> {
    const startTime = Date.now();
    const deadlineMs = resolveStepTimeoutMinutes(this.context.step) * 60_000 - DEADLINE_BUFFER_MS;

    const jobId = this.resolveJobId();
    await emit({
      type: 'status',
      payload: `Triggering Databricks job ${jobId}`,
      timestamp: new Date().toISOString(),
    });

    const runId = await this.client.runNow({
      jobId,
      notebookParams: this.resolveParams(this.config.notebookParams),
      jobParameters: this.resolveParams(this.config.jobParameters),
    });

    const finalStatus = await this.pollUntilTerminal(emit, runId, startTime, deadlineMs);

    if (finalStatus.resultState !== 'SUCCESS') {
      throw new Error(
        `Databricks job ${jobId} run ${runId} ended ${finalStatus.resultState ?? finalStatus.lifecycle}` +
        `${finalStatus.message !== null ? `: ${finalStatus.message}` : ''}` +
        `${finalStatus.runPageUrl !== null ? ` (${finalStatus.runPageUrl})` : ''}`,
      );
    }
    if (finalStatus.taskRunIds.length > 1) {
      throw new Error(
        `Databricks job ${jobId} has ${finalStatus.taskRunIds.length} tasks — ` +
        'databricks-job v1 supports single-task jobs only (the task output is the step result).',
      );
    }

    const result = await this.readResult(runId, finalStatus.taskRunIds[0]);
    const durationMs = Date.now() - startTime;

    await emit({
      type: 'result',
      payload: {
        confidence: 1.0,
        reasoning_summary: `Databricks job ${jobId} run ${runId} succeeded`,
        reasoning_chain: [
          `Job: ${jobId}`,
          `Run: ${runId}`,
          ...(finalStatus.runPageUrl !== null ? [`Run page: ${finalStatus.runPageUrl}`] : []),
          `State: ${finalStatus.lifecycle}/${finalStatus.resultState}`,
          `Duration: ${durationMs}ms`,
        ],
        annotations: [],
        model: 'databricks',
        duration_ms: durationMs,
        result,
      },
      timestamp: new Date().toISOString(),
    });
  }

  private resolveJobId(): number {
    if (typeof this.config.jobId === 'number') return this.config.jobId;
    const resolved = interpolate(this.config.jobId, this.interpolationSources());
    const parsed = Number(resolved);
    if (Number.isInteger(parsed) === false || parsed <= 0) {
      throw new Error(
        `Databricks jobId '${this.config.jobId}' resolved to '${String(resolved)}' — expected a positive integer job id`,
      );
    }
    return parsed;
  }

  private resolveParams(params: Record<string, string> | undefined): Record<string, string> | undefined {
    if (params === undefined) return undefined;
    const sources = this.interpolationSources();
    return Object.fromEntries(
      Object.entries(params).map(([key, template]) => {
        const resolved = interpolate(template, sources);
        return [key, typeof resolved === 'string' ? resolved : JSON.stringify(resolved)];
      }),
    );
  }

  /** Secrets are deliberately not an interpolation source — a templated
   *  param would otherwise leak token values into Databricks run params
   *  and audit snapshots. */
  private interpolationSources(): InterpolationSources {
    const steps = (this.context.stepInput['steps'] ?? {}) as Record<string, unknown>;
    return { steps, variables: steps, triggerPayload: {}, secrets: {} };
  }

  private async pollUntilTerminal(
    emit: EmitFn,
    runId: number,
    startTime: number,
    deadlineMs: number,
  ) {
    let lastLifecycle: string | null = null;
    let consecutiveFailures = 0;

    for (;;) {
      if (Date.now() - startTime > deadlineMs) {
        await this.client.cancelRun(runId).catch(() => undefined);
        throw new Error(
          `Databricks run ${runId} exceeded the step timeout — cancellation requested`,
        );
      }

      try {
        const status = await this.client.getRun(runId);
        consecutiveFailures = 0;
        if (status.lifecycle !== lastLifecycle) {
          lastLifecycle = status.lifecycle;
          await emit({
            type: 'status',
            payload: `Databricks run ${runId}: ${status.lifecycle}` +
              (status.runPageUrl !== null ? ` (${status.runPageUrl})` : ''),
            timestamp: new Date().toISOString(),
          });
        }
        if (isTerminalLifecycle(status.lifecycle)) return status;
      } catch (error) {
        consecutiveFailures += 1;
        if (consecutiveFailures >= MAX_CONSECUTIVE_POLL_FAILURES) throw error;
      }

      await this.sleep(this.config.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS);
    }
  }

  private async readResult(runId: number, taskRunId: number | undefined): Promise<Record<string, unknown>> {
    const output = await this.client.getRunOutput(taskRunId ?? runId);
    if (output.notebookResult === null || output.truncated === true) {
      return { raw: output.notebookResult ?? '' };
    }
    try {
      const parsed: unknown = JSON.parse(output.notebookResult);
      if (typeof parsed === 'object' && parsed !== null && Array.isArray(parsed) === false) {
        return parsed as Record<string, unknown>;
      }
      return { raw: output.notebookResult };
    } catch {
      return { raw: output.notebookResult };
    }
  }
}
