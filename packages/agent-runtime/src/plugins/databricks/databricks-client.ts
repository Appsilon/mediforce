/**
 * Thin REST client for the Databricks Jobs + run-output APIs (API 2.2).
 * Auth is a workspace PAT sent as a Bearer token. `fetchImpl` is injectable
 * for tests (same pattern as resolve-oauth-token.ts); defaults to global fetch.
 *
 * Endpoints validated against a real workspace by scripts/databricks-spike.py.
 */

export interface DatabricksClientInit {
  /** Workspace origin, e.g. https://dbc-xxxxxxxx.cloud.databricks.com */
  host: string;
  /** Personal access token. Required API scope: `jobs`. */
  token: string;
  fetchImpl?: typeof fetch;
}

export interface DatabricksRunStatus {
  /** PENDING | QUEUED | RUNNING | TERMINATING | TERMINATED | INTERNAL_ERROR | SKIPPED */
  lifecycle: string;
  /** SUCCESS | FAILED | CANCELED | TIMEDOUT | … — null until terminal. */
  resultState: string | null;
  message: string | null;
  runPageUrl: string | null;
  taskRunIds: number[];
}

const TERMINAL_LIFECYCLES = new Set(['TERMINATED', 'INTERNAL_ERROR', 'SKIPPED']);

export function isTerminalLifecycle(lifecycle: string): boolean {
  return TERMINAL_LIFECYCLES.has(lifecycle);
}

export interface DatabricksStatementStatus {
  state: string;
  errorMessage: string | null;
  columns: string[];
  rows: Array<Record<string, string | null>>;
  totalChunkCount: number;
}

const TERMINAL_STATEMENT_STATES = new Set(['SUCCEEDED', 'FAILED', 'CANCELED', 'CLOSED']);

export function isTerminalStatementState(state: string): boolean {
  return TERMINAL_STATEMENT_STATES.has(state);
}

interface RawStatementResponse {
  statement_id?: string;
  status?: { state?: string; error?: { message?: string } };
  manifest?: {
    schema?: { columns?: Array<{ name?: string }> };
    total_chunk_count?: number;
  };
  result?: { data_array?: Array<Array<string | null>> };
}

interface RawRunResponse {
  run_id?: number;
  run_page_url?: string;
  tasks?: Array<{ run_id?: number }>;
  /** Jobs API 2.2 shape */
  status?: {
    state?: string;
    termination_details?: { code?: string; message?: string };
  };
  /** Jobs API 2.1 legacy shape */
  state?: {
    life_cycle_state?: string;
    result_state?: string;
    state_message?: string;
  };
}

export class DatabricksClient {
  private readonly host: string;
  private readonly token: string;
  private readonly fetchImpl: typeof fetch;

  constructor(init: DatabricksClientInit) {
    this.host = init.host.replace(/\/+$/, '');
    this.token = init.token;
    this.fetchImpl = init.fetchImpl ?? fetch;
  }

  async runNow(args: {
    jobId: number;
    notebookParams?: Record<string, string>;
    jobParameters?: Record<string, string>;
  }): Promise<number> {
    const response = await this.request('POST', '/api/2.2/jobs/run-now', {
      job_id: args.jobId,
      ...(args.notebookParams !== undefined ? { notebook_params: args.notebookParams } : {}),
      ...(args.jobParameters !== undefined ? { job_parameters: args.jobParameters } : {}),
    });
    const runId = (response as { run_id?: number }).run_id;
    if (typeof runId !== 'number') {
      throw new Error(`Databricks run-now returned no run_id for job ${args.jobId}`);
    }
    return runId;
  }

  async getRun(runId: number): Promise<DatabricksRunStatus> {
    const run = await this.request('GET', `/api/2.2/jobs/runs/get?run_id=${runId}`) as RawRunResponse;
    return {
      lifecycle: run.status?.state ?? run.state?.life_cycle_state ?? 'PENDING',
      resultState: run.status?.termination_details?.code ?? run.state?.result_state ?? null,
      message: run.status?.termination_details?.message ?? run.state?.state_message ?? null,
      runPageUrl: run.run_page_url ?? null,
      taskRunIds: (run.tasks ?? [])
        .map((task) => task.run_id)
        .filter((taskRunId): taskRunId is number => typeof taskRunId === 'number'),
    };
  }

  async getRunOutput(taskRunId: number): Promise<{ notebookResult: string | null; truncated: boolean }> {
    const output = await this.request('GET', `/api/2.2/jobs/runs/get-output?run_id=${taskRunId}`) as {
      notebook_output?: { result?: string; truncated?: boolean };
    };
    return {
      notebookResult: output.notebook_output?.result ?? null,
      truncated: output.notebook_output?.truncated === true,
    };
  }

  async cancelRun(runId: number): Promise<void> {
    await this.request('POST', '/api/2.2/jobs/runs/cancel', { run_id: runId });
  }

  async executeStatement(args: {
    warehouseId: string;
    statement: string;
    parameters?: Record<string, string>;
  }): Promise<string> {
    const response = await this.request('POST', '/api/2.0/sql/statements', {
      warehouse_id: args.warehouseId,
      statement: args.statement,
      wait_timeout: '0s',
      format: 'JSON_ARRAY',
      disposition: 'INLINE',
      ...(args.parameters !== undefined
        ? { parameters: Object.entries(args.parameters).map(([name, value]) => ({ name, value, type: 'STRING' })) }
        : {}),
    });
    const statementId = (response as { statement_id?: string }).statement_id;
    if (typeof statementId !== 'string') {
      throw new Error('Databricks statement execution returned no statement_id');
    }
    return statementId;
  }

  async getStatement(statementId: string): Promise<DatabricksStatementStatus> {
    const raw = await this.request('GET', `/api/2.0/sql/statements/${statementId}`) as RawStatementResponse;
    const columns = (raw.manifest?.schema?.columns ?? [])
      .map((column) => column.name)
      .filter((name): name is string => typeof name === 'string');
    const rows = (raw.result?.data_array ?? []).map((row) =>
      Object.fromEntries(columns.map((name, idx) => [name, row[idx] ?? null])),
    );
    return {
      state: raw.status?.state ?? 'PENDING',
      errorMessage: raw.status?.error?.message ?? null,
      columns,
      rows,
      totalChunkCount: raw.manifest?.total_chunk_count ?? 1,
    };
  }

  async cancelStatement(statementId: string): Promise<void> {
    await this.request('POST', `/api/2.0/sql/statements/${statementId}/cancel`);
  }

  private async request(method: 'GET' | 'POST', path: string, body?: Record<string, unknown>): Promise<unknown> {
    const response = await this.fetchImpl(`${this.host}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.token}`,
        'Content-Type': 'application/json',
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const text = await response.text();
    if (response.ok === false) {
      // Body excerpt only — the token never appears in error messages.
      throw new Error(
        `Databricks ${method} ${path} failed (HTTP ${response.status}): ${text.slice(0, 300)}`,
      );
    }
    return text.length > 0 ? JSON.parse(text) : {};
  }
}
