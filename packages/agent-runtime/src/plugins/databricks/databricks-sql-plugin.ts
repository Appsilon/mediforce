import {
  DatabricksSqlConfigSchema,
  interpolate,
  resolveStepTimeoutMinutes,
  type DatabricksSqlConfig,
  type InterpolationSources,
  type PluginCapabilityMetadata,
} from '@mediforce/platform-core';
import type { AgentContext, StepExecutorPlugin, EmitFn, WorkflowAgentContext } from '../../interfaces/step-executor-plugin';
import { isWorkflowAgentContext } from '../container-plugin';
import { DatabricksClient, isTerminalStatementState } from './databricks-client';

const MAX_CONSECUTIVE_POLL_FAILURES = 3;
const DEFAULT_POLL_INTERVAL_MS = 2_000;
const DEADLINE_BUFFER_MS = 5_000;

export interface DatabricksSqlPluginInit {
  fetchImpl?: typeof fetch;
  sleepImpl?: (ms: number) => Promise<void>;
}

export class DatabricksSqlPlugin implements StepExecutorPlugin {
  readonly metadata: PluginCapabilityMetadata = {
    name: 'Databricks SQL',
    description: 'Runs one SQL statement against a Databricks SQL Warehouse and returns the result rows — no LLM, no job.',
    inputDescription: 'step.databricksSql: warehouseId + statement + optional named parameters (values support ${steps.*} interpolation, bound server-side as Databricks named parameters — never concatenated into the statement text). Secrets: DATABRICKS_HOST, DATABRICKS_TOKEN.',
    outputDescription: '{ columns, rows, rowCount } — rows as an array of objects keyed by column name.',
    roles: ['executor'],
    requiredEnv: [['DATABRICKS_HOST', 'DATABRICKS_TOKEN']],
  };

  private context!: WorkflowAgentContext;
  private config!: DatabricksSqlConfig;
  private client!: DatabricksClient;
  private readonly fetchImpl?: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(init: DatabricksSqlPluginInit = {}) {
    this.fetchImpl = init.fetchImpl;
    this.sleep = init.sleepImpl
      ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  async initialize(context: AgentContext | WorkflowAgentContext): Promise<void> {
    if (!isWorkflowAgentContext(context)) {
      throw new Error('DatabricksSqlPlugin requires the WorkflowDefinition model (legacy ProcessConfig is not supported)');
    }
    this.context = context;

    if (context.step.databricksSql === undefined) {
      throw new Error(
        `No databricksSql config found for step '${context.stepId}'. ` +
        'DatabricksSqlPlugin requires step.databricksSql with a warehouseId and statement.',
      );
    }
    this.config = DatabricksSqlConfigSchema.parse(context.step.databricksSql);

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

    await emit({
      type: 'status',
      payload: `Running Databricks SQL statement on warehouse ${this.config.warehouseId}`,
      timestamp: new Date().toISOString(),
    });

    const statementId = await this.client.executeStatement({
      warehouseId: this.config.warehouseId,
      statement: this.config.statement,
      parameters: this.resolveParameters(),
    });

    const finalStatus = await this.pollUntilTerminal(emit, statementId, startTime, deadlineMs);

    if (finalStatus.state !== 'SUCCEEDED') {
      throw new Error(
        `Databricks SQL statement ${statementId} ended ${finalStatus.state}` +
        `${finalStatus.errorMessage !== null ? `: ${finalStatus.errorMessage}` : ''}`,
      );
    }
    if (finalStatus.totalChunkCount > 1) {
      throw new Error(
        `Databricks SQL statement ${statementId} returned ${finalStatus.totalChunkCount} result chunks — ` +
        'databricks-sql v1 supports single-chunk results only (add a LIMIT or narrow the query).',
      );
    }

    const durationMs = Date.now() - startTime;
    await emit({
      type: 'result',
      payload: {
        confidence: 1.0,
        reasoning_summary: `Databricks SQL statement ${statementId} succeeded`,
        reasoning_chain: [
          `Warehouse: ${this.config.warehouseId}`,
          `Statement: ${statementId}`,
          `Rows: ${finalStatus.rows.length}`,
          `Duration: ${durationMs}ms`,
        ],
        annotations: [],
        model: 'databricks',
        duration_ms: durationMs,
        result: { columns: finalStatus.columns, rows: finalStatus.rows, rowCount: finalStatus.rows.length },
      },
      timestamp: new Date().toISOString(),
    });
  }

  private resolveParameters(): Record<string, string> | undefined {
    if (this.config.parameters === undefined) return undefined;
    const sources = this.interpolationSources();
    return Object.fromEntries(
      Object.entries(this.config.parameters).map(([key, template]) => {
        const resolved = interpolate(template, sources);
        return [key, typeof resolved === 'string' ? resolved : JSON.stringify(resolved)];
      }),
    );
  }

  private interpolationSources(): InterpolationSources {
    const steps = (this.context.stepInput['steps'] ?? {}) as Record<string, unknown>;
    return { steps, variables: steps, triggerPayload: {}, secrets: {} };
  }

  private async pollUntilTerminal(
    emit: EmitFn,
    statementId: string,
    startTime: number,
    deadlineMs: number,
  ) {
    let lastState: string | null = null;
    let consecutiveFailures = 0;

    for (;;) {
      if (Date.now() - startTime > deadlineMs) {
        await this.client.cancelStatement(statementId).catch(() => undefined);
        throw new Error(
          `Databricks SQL statement ${statementId} exceeded the step timeout — cancellation requested`,
        );
      }

      try {
        const status = await this.client.getStatement(statementId);
        consecutiveFailures = 0;
        if (status.state !== lastState) {
          lastState = status.state;
          await emit({
            type: 'status',
            payload: `Databricks SQL statement ${statementId}: ${status.state}`,
            timestamp: new Date().toISOString(),
          });
        }
        if (isTerminalStatementState(status.state)) return status;
      } catch (error) {
        consecutiveFailures += 1;
        if (consecutiveFailures >= MAX_CONSECUTIVE_POLL_FAILURES) throw error;
      }

      await this.sleep(this.config.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS);
    }
  }
}
