import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AgentContext, WorkflowAgentContext, EmitFn, EmitPayload } from '../../interfaces/step-executor-plugin';
import type { ProcessConfig, WorkflowStep } from '@mediforce/platform-core';
import { AgentOutputEnvelopeSchema } from '@mediforce/platform-core';
import { buildWorkflowDefinition } from '@mediforce/platform-core/testing';
import { DatabricksJobPlugin } from '../databricks/databricks-job-plugin';

const HOST = 'https://dbc-test.cloud.databricks.com';
const TOKEN = 'dapi-test-token';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

interface FetchPlan {
  /** Responses for successive GET /jobs/runs/get calls (shifted per call). */
  runStates: Array<Response>;
  runNow?: Response;
  output?: Response;
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
    if (url.includes('/jobs/run-now')) {
      return plan.runNow ?? jsonResponse({ run_id: 777 });
    }
    if (url.includes('/jobs/runs/get-output')) {
      return plan.output ?? jsonResponse({ notebook_output: { result: '{"route":"a"}' } });
    }
    if (url.includes('/jobs/runs/get')) {
      const next = plan.runStates.shift();
      if (next === undefined) throw new Error('fetch mock: runStates exhausted');
      return next;
    }
    if (url.includes('/jobs/runs/cancel')) {
      return plan.cancel ?? jsonResponse({});
    }
    throw new Error(`fetch mock: unexpected URL ${url}`);
  }) as unknown as typeof fetch;
  return { fetchImpl, requests };
}

function runState(state: string, extras: Record<string, unknown> = {}): Response {
  return jsonResponse({
    run_id: 777,
    run_page_url: `${HOST}/jobs/runs/777`,
    tasks: [{ run_id: 888 }],
    status: { state, ...extras },
  });
}

function buildStep(databricks: Record<string, unknown>): WorkflowStep {
  return {
    id: 'run-job',
    name: 'Run job',
    type: 'creation',
    executor: 'script',
    plugin: 'databricks-job',
    databricks,
  } as WorkflowStep;
}

function buildContext(overrides: Partial<WorkflowAgentContext> = {}): WorkflowAgentContext {
  return {
    stepId: 'run-job',
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
    step: buildStep({ jobId: 123 }),
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

describe('DatabricksJobPlugin', () => {
  let plugin: DatabricksJobPlugin;

  beforeEach(() => {
    plugin = new DatabricksJobPlugin({ sleepImpl: instantSleep });
  });

  describe('initialize', () => {
    it('[ERROR] rejects the legacy AgentContext model', async () => {
      const legacyContext: AgentContext = {
        stepId: 'run-job',
        processInstanceId: 'pi-001',
        definitionVersion: 'v1',
        stepInput: {},
        autonomyLevel: 'L4',
        config: {
          processName: 'x',
          configName: 'default',
          configVersion: 'v1',
          stepConfigs: [],
        } satisfies ProcessConfig,
        llm: { complete: vi.fn() },
        getPreviousStepOutputs: vi.fn().mockResolvedValue({}),
      };
      await expect(plugin.initialize(legacyContext)).rejects.toThrow(/WorkflowDefinition model/);
    });

    it('[ERROR] throws when step.databricks is missing', async () => {
      const context = buildContext({ step: { ...buildStep({ jobId: 1 }), databricks: undefined } });
      await expect(plugin.initialize(context)).rejects.toThrow(/no databricks config/i);
    });

    it('[ERROR] names both secrets when credentials are absent', async () => {
      const context = buildContext({ workflowSecrets: {} });
      await expect(plugin.initialize(context)).rejects.toThrow(/DATABRICKS_HOST and DATABRICKS_TOKEN/);
    });
  });

  describe('run', () => {
    it('[DATA] happy path: triggers, polls to SUCCESS, emits parsed notebook result as a valid envelope', async () => {
      const { fetchImpl, requests } = buildFetchMock({
        runStates: [
          runState('PENDING'),
          runState('RUNNING'),
          runState('TERMINATED', { termination_details: { code: 'SUCCESS' } }),
        ],
      });
      plugin = new DatabricksJobPlugin({ fetchImpl, sleepImpl: instantSleep });
      await plugin.initialize(buildContext());

      const { emit, events } = buildEmitSpy();
      await plugin.run(emit);

      const runNowRequest = requests.find((request) => request.url.includes('run-now'));
      expect(runNowRequest?.authorization).toBe(`Bearer ${TOKEN}`);
      expect(runNowRequest?.body).toMatchObject({ job_id: 123 });

      const statusEvents = events.filter((event) => event.type === 'status');
      expect(statusEvents.map((event) => event.payload)).toEqual([
        'Triggering Databricks job 123',
        expect.stringContaining('PENDING'),
        expect.stringContaining('RUNNING'),
        expect.stringContaining('TERMINATED'),
      ]);

      const resultEvents = events.filter((event) => event.type === 'result');
      expect(resultEvents).toHaveLength(1);
      const envelope = AgentOutputEnvelopeSchema.parse(resultEvents[0].payload);
      expect(envelope.confidence).toBe(1.0);
      expect(envelope.model).toBe('databricks');
      expect(envelope.result).toEqual({ route: 'a' });

      const outputRequest = requests.find((request) => request.url.includes('get-output'));
      expect(outputRequest?.url).toContain('run_id=888');
    });

    it('[DATA] wraps non-JSON notebook output as { raw }', async () => {
      const { fetchImpl } = buildFetchMock({
        runStates: [runState('TERMINATED', { termination_details: { code: 'SUCCESS' } })],
        output: jsonResponse({ notebook_output: { result: 'all done' } }),
      });
      plugin = new DatabricksJobPlugin({ fetchImpl, sleepImpl: instantSleep });
      await plugin.initialize(buildContext());

      const { emit, events } = buildEmitSpy();
      await plugin.run(emit);

      const resultEvent = events.find((event) => event.type === 'result');
      expect((resultEvent?.payload as { result: unknown }).result).toEqual({ raw: 'all done' });
    });

    it('[DATA] interpolates ${steps.*} placeholders in notebookParams before run-now', async () => {
      const { fetchImpl, requests } = buildFetchMock({
        runStates: [runState('TERMINATED', { termination_details: { code: 'SUCCESS' } })],
      });
      plugin = new DatabricksJobPlugin({ fetchImpl, sleepImpl: instantSleep });
      await plugin.initialize(
        buildContext({
          step: buildStep({
            jobId: 123,
            notebookParams: { batch_id: '${steps.prepare.batchId}', static: 'fixed' },
          }),
          stepInput: { steps: { prepare: { batchId: 'B-42' } } },
        }),
      );

      const { emit } = buildEmitSpy();
      await plugin.run(emit);

      const runNowRequest = requests.find((request) => request.url.includes('run-now'));
      expect(runNowRequest?.body).toMatchObject({
        notebook_params: { batch_id: 'B-42', static: 'fixed' },
      });
    });

    it('[ERROR] failed run rejects with state, message, and run page URL — no result event', async () => {
      const { fetchImpl } = buildFetchMock({
        runStates: [
          runState('TERMINATED', {
            termination_details: { code: 'FAILED', message: 'notebook exception' },
          }),
        ],
      });
      plugin = new DatabricksJobPlugin({ fetchImpl, sleepImpl: instantSleep });
      await plugin.initialize(buildContext());

      const { emit, events } = buildEmitSpy();
      const error = await plugin.run(emit).catch((caught: unknown) => caught);

      expect((error as Error).message).toContain('FAILED');
      expect((error as Error).message).toContain('notebook exception');
      expect((error as Error).message).toContain('/jobs/runs/777');
      expect((error as Error).message).not.toContain(TOKEN);
      expect(events.filter((event) => event.type === 'result')).toHaveLength(0);
    });

    it('[ERROR] multi-task job rejects with a single-task-only message', async () => {
      const { fetchImpl } = buildFetchMock({
        runStates: [
          jsonResponse({
            run_id: 777,
            tasks: [{ run_id: 888 }, { run_id: 889 }],
            status: { state: 'TERMINATED', termination_details: { code: 'SUCCESS' } },
          }),
        ],
      });
      plugin = new DatabricksJobPlugin({ fetchImpl, sleepImpl: instantSleep });
      await plugin.initialize(buildContext());

      const { emit } = buildEmitSpy();
      await expect(plugin.run(emit)).rejects.toThrow(/single-task/);
    });

    it('[ERROR] internal deadline cancels the run and rejects', async () => {
      const { fetchImpl, requests } = buildFetchMock({ runStates: [runState('RUNNING')] });
      plugin = new DatabricksJobPlugin({ fetchImpl, sleepImpl: instantSleep });
      // timeoutMinutes small enough that the deadline (minus the 5s cancel
      // buffer) is already in the past on the first poll iteration.
      await plugin.initialize(
        buildContext({
          step: buildStep({ jobId: 123, timeoutMinutes: 0.0001 }),
        }),
      );

      const { emit } = buildEmitSpy();
      await expect(plugin.run(emit)).rejects.toThrow(/exceeded the step timeout/);
      expect(requests.some((request) => request.url.includes('runs/cancel'))).toBe(true);
    });

    it('[ERROR] three consecutive poll failures reject; a transient one recovers', async () => {
      const failing = buildFetchMock({
        runStates: [
          jsonResponse({ error: 'boom' }, 500),
          jsonResponse({ error: 'boom' }, 500),
          jsonResponse({ error: 'boom' }, 500),
        ],
      });
      plugin = new DatabricksJobPlugin({ fetchImpl: failing.fetchImpl, sleepImpl: instantSleep });
      await plugin.initialize(buildContext());
      const failure = await plugin.run(buildEmitSpy().emit).catch((caught: unknown) => caught);
      expect((failure as Error).message).toContain('HTTP 500');
      expect((failure as Error).message).not.toContain(TOKEN);

      const recovering = buildFetchMock({
        runStates: [
          jsonResponse({ error: 'blip' }, 502),
          runState('TERMINATED', { termination_details: { code: 'SUCCESS' } }),
        ],
      });
      plugin = new DatabricksJobPlugin({ fetchImpl: recovering.fetchImpl, sleepImpl: instantSleep });
      await plugin.initialize(buildContext());
      const { emit, events } = buildEmitSpy();
      await plugin.run(emit);
      expect(events.filter((event) => event.type === 'result')).toHaveLength(1);
    });
  });
});
