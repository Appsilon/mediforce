import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { APIRequestContext } from '@playwright/test';
import { test, expect } from '../helpers/test-fixtures';
import { TEST_ORG_HANDLE } from '../helpers/constants';

/**
 * L3 API E2E for deterministic script-executor plugin dispatch — proves the
 * full path: POST /api/processes → auto-runner → AgentRunner → PluginRegistry
 * → plugin → result persisted → readable via GET /api/processes/:id/steps.
 *
 * script-container: inline javascript, executed in local mode (the e2e server
 * runs with ALLOW_LOCAL_AGENTS=true so no Docker daemon is required — the
 * dispatch path is identical, only the spawn target differs; the Docker spawn
 * itself is covered by the agent-runtime L5 suite).
 *
 * databricks-job: the test starts a mock Databricks Jobs API on a local port
 * and injects DATABRICKS_HOST/DATABRICKS_TOKEN as per-workflow secrets via
 * PUT /api/workflow-secrets/values — proving secrets reach the plugin and the
 * notebook JSON lands as the step output.
 */

const API_KEY = process.env.PLATFORM_API_KEY ?? 'test-api-key';
const JSON_HEADERS = { 'X-Api-Key': API_KEY, 'Content-Type': 'application/json' };

async function pollUntil<T>(
  fn: () => Promise<T | null>,
  {
    timeoutMs = 25_000,
    intervalMs = 250,
    description = 'condition',
  }: { timeoutMs?: number; intervalMs?: number; description?: string } = {},
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await fn();
    if (value !== null) return value;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(`Timed out waiting for ${description} (${timeoutMs}ms)`);
}

interface StepsResponse {
  steps: Array<{
    stepId: string;
    executorType?: string;
    execution: { status: string; output?: Record<string, unknown>; error?: string } | null;
  }>;
}

async function startRun(request: APIRequestContext, wdName: string): Promise<string> {
  const triggerRes = await request.post('/api/processes', {
    headers: JSON_HEADERS,
    data: {
      namespace: TEST_ORG_HANDLE,
      definitionName: wdName,
      triggeredBy: 'e2e-test',
      triggerName: 'Start',
    },
  });
  expect(triggerRes.status(), await triggerRes.text()).toBe(201);
  const { run } = (await triggerRes.json()) as { run: { id: string } };
  return run.id;
}

async function waitForStepResult(
  request: APIRequestContext,
  instanceId: string,
  stepId: string,
): Promise<NonNullable<StepsResponse['steps'][number]['execution']>> {
  return pollUntil(
    async () => {
      const res = await request.get(`/api/processes/${instanceId}/steps`, {
        headers: { 'X-Api-Key': API_KEY },
      });
      if (res.status() !== 200) return null;
      const body = (await res.json()) as StepsResponse;
      const entry = body.steps.find((step) => step.stepId === stepId);
      if (entry?.execution == null) return null;
      if (entry.execution.status === 'failed') {
        throw new Error(`step '${stepId}' failed: ${entry.execution.error ?? 'no error detail'}`);
      }
      return entry.execution.status === 'completed' ? entry.execution : null;
    },
    { description: `step '${stepId}' of ${instanceId} to complete` },
  );
}

test.describe('script-container dispatch — API E2E', () => {
  test('inline script runs through the engine and its result.json becomes the step output', async ({
    request,
  }) => {
    const wdName = `e2e-script-dispatch-${Date.now()}`;

    const wd = {
      name: wdName,
      title: 'E2E script-container dispatch',
      steps: [
        {
          id: 'emit-result',
          name: 'Emit result',
          type: 'creation',
          executor: 'script',
          plugin: 'script-container',
          script: {
            runtime: 'javascript',
            inlineScript: [
              "import { writeFileSync } from 'fs';",
              "writeFileSync('/output/result.json', JSON.stringify({ greeting: 'hello from L3', doubled: 21 * 2 }));",
            ].join('\n'),
          },
        },
        { id: 'done', name: 'Done', type: 'terminal', executor: 'human' },
      ],
      transitions: [{ from: 'emit-result', to: 'done' }],
      triggers: [{ type: 'manual', name: 'Start' }],
    };

    const createWdRes = await request.post(
      `/api/workflow-definitions?namespace=${TEST_ORG_HANDLE}`,
      { headers: JSON_HEADERS, data: wd },
    );
    expect(createWdRes.status(), await createWdRes.text()).toBe(201);

    const instanceId = await startRun(request, wdName);
    const execution = await waitForStepResult(request, instanceId, 'emit-result');

    expect(execution.output).toMatchObject({ greeting: 'hello from L3', doubled: 42 });

    const stepsRes = await request.get(`/api/processes/${instanceId}/steps`, {
      headers: { 'X-Api-Key': API_KEY },
    });
    const stepsBody = (await stepsRes.json()) as StepsResponse;
    expect(stepsBody.steps.find((step) => step.stepId === 'emit-result')?.executorType).toBe('script');
  });
});

test.describe('databricks-job dispatch — API E2E', () => {
  let mockDatabricks: Server;
  let mockHost: string;
  const seenRequests: Array<{ method: string; path: string; authorization?: string; body?: unknown }> = [];

  test.beforeAll(async () => {
    mockDatabricks = createServer((req, res) => {
      let raw = '';
      req.on('data', (chunk: Buffer) => { raw += chunk.toString(); });
      req.on('end', () => {
        seenRequests.push({
          method: req.method ?? '',
          path: req.url ?? '',
          authorization: req.headers.authorization,
          body: raw.length > 0 ? JSON.parse(raw) : undefined,
        });

        const respond = (payload: Record<string, unknown>): void => {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(payload));
        };
        const url = req.url ?? '';
        if (url.startsWith('/api/2.2/jobs/run-now')) {
          respond({ run_id: 9001 });
        } else if (url.startsWith('/api/2.2/jobs/runs/get-output')) {
          respond({
            notebook_output: {
              result: JSON.stringify({ rows_validated: 128, status: 'PASS' }),
              truncated: false,
            },
          });
        } else if (url.startsWith('/api/2.2/jobs/runs/get')) {
          respond({
            run_id: 9001,
            run_page_url: `${mockHost}/run/9001`,
            tasks: [{ run_id: 9002 }],
            status: { state: 'TERMINATED', termination_details: { code: 'SUCCESS' } },
          });
        } else {
          res.writeHead(404).end();
        }
      });
    });
    await new Promise<void>((resolve) => mockDatabricks.listen(0, '127.0.0.1', resolve));
    mockHost = `http://127.0.0.1:${(mockDatabricks.address() as AddressInfo).port}`;
  });

  test.afterAll(async () => {
    await new Promise<void>((resolve) => mockDatabricks.close(() => resolve()));
  });

  test('databricks step triggers run-now with workflow secrets and lands the notebook JSON as step output', async ({
    request,
  }) => {
    const wdName = `e2e-databricks-dispatch-${Date.now()}`;

    const wd = {
      name: wdName,
      title: 'E2E databricks-job dispatch',
      steps: [
        {
          id: 'run-checks',
          name: 'Run checks',
          type: 'creation',
          executor: 'script',
          plugin: 'databricks-job',
          databricks: {
            jobId: 4242,
            notebookParams: { study: 'CDISC01' },
            pollIntervalMs: 100,
          },
        },
        { id: 'done', name: 'Done', type: 'terminal', executor: 'human' },
      ],
      transitions: [{ from: 'run-checks', to: 'done' }],
      triggers: [{ type: 'manual', name: 'Start' }],
    };

    const createWdRes = await request.post(
      `/api/workflow-definitions?namespace=${TEST_ORG_HANDLE}`,
      { headers: JSON_HEADERS, data: wd },
    );
    expect(createWdRes.status(), await createWdRes.text()).toBe(201);

    const secretsRes = await request.put(
      `/api/workflow-secrets/values?namespace=${TEST_ORG_HANDLE}&workflow=${wdName}`,
      {
        headers: JSON_HEADERS,
        data: {
          secrets: {
            DATABRICKS_HOST: mockHost,
            DATABRICKS_TOKEN: 'e2e-mock-token',
          },
        },
      },
    );
    expect(secretsRes.status(), await secretsRes.text()).toBe(200);

    const instanceId = await startRun(request, wdName);
    const execution = await waitForStepResult(request, instanceId, 'run-checks');

    expect(execution.output).toMatchObject({ rows_validated: 128, status: 'PASS' });

    const runNow = seenRequests.find((r) => r.path.startsWith('/api/2.2/jobs/run-now'));
    expect(runNow, 'mock Databricks never received run-now').toBeDefined();
    expect(runNow?.authorization).toBe('Bearer e2e-mock-token');
    expect(runNow?.body).toMatchObject({ job_id: 4242, notebook_params: { study: 'CDISC01' } });
  });
});
