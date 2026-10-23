import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AgentContext, WorkflowAgentContext, EmitFn, EmitPayload } from '../../interfaces/step-executor-plugin';
import type { ProcessConfig, WorkflowStep } from '@mediforce/platform-core';
import { AgentOutputEnvelopeSchema } from '@mediforce/platform-core';
import { buildWorkflowDefinition } from '@mediforce/platform-core/testing';
import { DatabricksSqlPlugin } from '../databricks/databricks-sql-plugin';

const HOST = 'https://dbc-test.cloud.databricks.com';
const TOKEN = 'dapi-test-token';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

interface FetchPlan {
  statementStates: Array<Response>;
  execute?: Response;
  cancel?: Response;
}

interface RecordedRequest {
  url: string;
  method: string;
  authorization: string | null;
  body: unknown;
}

function buildFetchMock(plan: FetchPlan): { fetchImpl: typeof fetch; requests: RecordedRequest[] } {
  const requests: RecordedRequest[] = [];
  const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    const headers = new Headers(init?.headers);
    requests.push({
      url,
      method: init?.method ?? 'GET',
      authorization: headers.get('Authorization'),
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
    });
    if (url.endsWith('/api/2.0/sql/statements')) {
      return plan.execute ?? jsonResponse({ statement_id: 'stmt-777' });
    }
    if (url.includes('/cancel')) {
      return plan.cancel ?? jsonResponse({});
    }
    if (url.includes('/api/2.0/sql/statements/')) {
      const next = plan.statementStates.shift();
      if (next === undefined) throw new Error('fetch mock: statementStates exhausted');
      return next;
    }
    throw new Error(`fetch mock: unexpected URL ${url}`);
  }) as unknown as typeof fetch;
  return { fetchImpl, requests };
}

function statementStatus(state: string, extras: Record<string, unknown> = {}): Response {
  return jsonResponse({
    statement_id: 'stmt-777',
    status: { state, ...extras },
    manifest: {
      schema: { columns: [{ name: 'study_id' }, { name: 'n_subjects' }] },
      total_chunk_count: 1,
    },
    result: { data_array: [['CDISC01', '42']] },
  });
}

function buildStep(databricksSql: Record<string, unknown>): WorkflowStep {
  return {
    id: 'run-query',
    name: 'Run query',
    type: 'creation',
    executor: 'script',
    plugin: 'databricks-sql',
    databricksSql,
  } as WorkflowStep;
}

function buildContext(overrides: Partial<WorkflowAgentContext> = {}): WorkflowAgentContext {
  return {
    stepId: 'run-query',
    processInstanceId: 'pi-001',
    runNamespace: 'acme',
    definitionVersion: '1',
    stepInput: { steps: {} },
    autonomyLevel: 'L4',
    workflowDefinition: buildWorkflowDefinition({
      name: 'sdtm-checks',
      version: 1,
      namespace: 'acme',
      steps: [],
      transitions: [],
    }),
    step: buildStep({ warehouseId: 'wh-123', statement: 'SELECT * FROM studies' }),
    llm: { complete: vi.fn() },
    getPreviousStepOutputs: vi.fn().mockResolvedValue({}),
    workflowSecrets: { DATABRICKS_HOST: HOST, DATABRICKS_TOKEN: TOKEN },
    ...overrides,
  };
}

function buildEmitSpy(): { emit: EmitFn; events: EmitPayload[] } {
  const events: EmitPayload[] = [];
  const emit: EmitFn = vi.fn(async (event: EmitPayload) => {
    events.push(event);
  });
  return { emit, events };
}

const instantSleep = async (): Promise<void> => {};

describe('DatabricksSqlPlugin', () => {
  let plugin: DatabricksSqlPlugin;

  beforeEach(() => {
    plugin = new DatabricksSqlPlugin({ sleepImpl: instantSleep });
  });

  describe('initialize', () => {
    it('[ERROR] rejects the legacy AgentContext model', async () => {
      const legacyContext: AgentContext = {
        stepId: 'run-query',
        processInstanceId: 'pi-001',
        definitionVersion: 'v1',
        stepInput: {},
        autonomyLevel: 'L4',
        config: {
          processName: 'x', configName: 'default', configVersion: 'v1', stepConfigs: [],
        } satisfies ProcessConfig,
        llm: { complete: vi.fn() },
        getPreviousStepOutputs: vi.fn().mockResolvedValue({}),
      };
      await expect(plugin.initialize(legacyContext)).rejects.toThrow(/WorkflowDefinition model/);
    });

    it('[ERROR] throws when step.databricksSql is missing', async () => {
      const context = buildContext({ step: { ...buildStep({ warehouseId: 'wh-1', statement: 'SELECT 1' }), databricksSql: undefined } });
      await expect(plugin.initialize(context)).rejects.toThrow(/no databricksSql config/i);
    });

    it('[ERROR] names both secrets when credentials are absent', async () => {
      const context = buildContext({ workflowSecrets: {} });
      await expect(plugin.initialize(context)).rejects.toThrow(/DATABRICKS_HOST and DATABRICKS_TOKEN/);
    });
  });

  describe('run', () => {
    it('[DATA] happy path: triggers, polls to SUCCEEDED, emits rows as a valid envelope', async () => {
      const { fetchImpl, requests } = buildFetchMock({
        statementStates: [
          statementStatus('PENDING'),
          statementStatus('RUNNING'),
          statementStatus('SUCCEEDED'),
        ],
      });
      plugin = new DatabricksSqlPlugin({ fetchImpl, sleepImpl: instantSleep });
      await plugin.initialize(buildContext());

      const { emit, events } = buildEmitSpy();
      await plugin.run(emit);

      const executeRequest = requests.find((request) => request.url.endsWith('/api/2.0/sql/statements'));
      expect(executeRequest?.authorization).toBe(`Bearer ${TOKEN}`);
      expect(executeRequest?.body).toMatchObject({ warehouse_id: 'wh-123', statement: 'SELECT * FROM studies' });

      const statusEvents = events.filter((event) => event.type === 'status');
      expect(statusEvents.map((event) => event.payload)).toEqual([
        'Running Databricks SQL statement on warehouse wh-123',
        expect.stringContaining('PENDING'),
        expect.stringContaining('RUNNING'),
        expect.stringContaining('SUCCEEDED'),
      ]);

      const resultEvents = events.filter((event) => event.type === 'result');
      expect(resultEvents).toHaveLength(1);
      const envelope = AgentOutputEnvelopeSchema.parse(resultEvents[0].payload);
      expect(envelope.confidence).toBe(1.0);
      expect(envelope.model).toBe('databricks');
      expect(envelope.result).toEqual({
        columns: ['study_id', 'n_subjects'],
        rows: [{ study_id: 'CDISC01', n_subjects: '42' }],
        rowCount: 1,
      });
    });

    it('[DATA] binds ${steps.*} parameter values as named parameters — statement text is never touched', async () => {
      const { fetchImpl, requests } = buildFetchMock({
        statementStates: [statementStatus('SUCCEEDED')],
      });
      plugin = new DatabricksSqlPlugin({ fetchImpl, sleepImpl: instantSleep });
      const maliciousValue = "CDISC01'; DROP TABLE studies; --";
      await plugin.initialize(buildContext({
        step: buildStep({
          warehouseId: 'wh-123',
          statement: 'SELECT * FROM studies WHERE study_id = :study_id',
          parameters: { study_id: '${steps.lookup.studyId}' },
        }),
        stepInput: { steps: { lookup: { studyId: maliciousValue } } },
      }));

      const { emit } = buildEmitSpy();
      await plugin.run(emit);

      const executeRequest = requests.find((request) => request.url.endsWith('/api/2.0/sql/statements'));
      expect(executeRequest?.body).toMatchObject({
        statement: 'SELECT * FROM studies WHERE study_id = :study_id',
        parameters: [{ name: 'study_id', value: maliciousValue, type: 'STRING' }],
      });
    });

    it('[ERROR] failed statement rejects with state and message — no result event', async () => {
      const { fetchImpl } = buildFetchMock({
        statementStates: [statementStatus('FAILED', { error: { message: 'syntax error' } })],
      });
      plugin = new DatabricksSqlPlugin({ fetchImpl, sleepImpl: instantSleep });
      await plugin.initialize(buildContext());

      const { emit, events } = buildEmitSpy();
      const error = await plugin.run(emit).catch((caught: unknown) => caught);

      expect((error as Error).message).toContain('FAILED');
      expect((error as Error).message).toContain('syntax error');
      expect((error as Error).message).not.toContain(TOKEN);
      expect(events.filter((event) => event.type === 'result')).toHaveLength(0);
    });

    it('[ERROR] multi-chunk result rejects with a single-chunk-only message', async () => {
      const { fetchImpl } = buildFetchMock({
        statementStates: [jsonResponse({
          statement_id: 'stmt-777',
          status: { state: 'SUCCEEDED' },
          manifest: { schema: { columns: [{ name: 'id' }] }, total_chunk_count: 3 },
          result: { data_array: [['1']] },
        })],
      });
      plugin = new DatabricksSqlPlugin({ fetchImpl, sleepImpl: instantSleep });
      await plugin.initialize(buildContext());

      const { emit } = buildEmitSpy();
      await expect(plugin.run(emit)).rejects.toThrow(/single-chunk/);
    });

    it('[ERROR] internal deadline cancels the statement and rejects', async () => {
      const { fetchImpl, requests } = buildFetchMock({ statementStates: [statementStatus('RUNNING')] });
      plugin = new DatabricksSqlPlugin({ fetchImpl, sleepImpl: instantSleep });
      await plugin.initialize(buildContext({
        step: buildStep({ warehouseId: 'wh-123', statement: 'SELECT 1', timeoutMinutes: 0.0001 }),
      }));

      const { emit } = buildEmitSpy();
      await expect(plugin.run(emit)).rejects.toThrow(/exceeded the step timeout/);
      expect(requests.some((request) => request.url.includes('/cancel'))).toBe(true);
    });

    it('[ERROR] three consecutive poll failures reject; a transient one recovers', async () => {
      const failing = buildFetchMock({
        statementStates: [
          jsonResponse({ error: 'boom' }, 500),
          jsonResponse({ error: 'boom' }, 500),
          jsonResponse({ error: 'boom' }, 500),
        ],
      });
      plugin = new DatabricksSqlPlugin({ fetchImpl: failing.fetchImpl, sleepImpl: instantSleep });
      await plugin.initialize(buildContext());
      const failure = await plugin.run(buildEmitSpy().emit).catch((caught: unknown) => caught);
      expect((failure as Error).message).toContain('HTTP 500');
      expect((failure as Error).message).not.toContain(TOKEN);

      const recovering = buildFetchMock({
        statementStates: [
          jsonResponse({ error: 'blip' }, 502),
          statementStatus('SUCCEEDED'),
        ],
      });
      plugin = new DatabricksSqlPlugin({ fetchImpl: recovering.fetchImpl, sleepImpl: instantSleep });
      await plugin.initialize(buildContext());
      const { emit, events } = buildEmitSpy();
      await plugin.run(emit);
      expect(events.filter((event) => event.type === 'result')).toHaveLength(1);
    });
  });
});
