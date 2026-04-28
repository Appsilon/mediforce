/**
 * Golden e2e: webhook → http action → reshape action → polling.
 *
 * Adds a SECOND chained action step on top of execution-summaries-api,
 * validating:
 *  - Multi-step workflow with action executors only (no agent/script).
 *  - Variables propagation: reshape reads `${steps.proxy.body.json.json}` from
 *    the upstream http step's output.
 *  - Reshape kind extensibility — same registry dispatch path as http; both
 *    handlers compose without engine changes.
 *  - WorkflowTemplate loader handles a different file from the same app.
 *
 * Mirrors the execution-summaries-api wiring (in-memory repos via vi.mock,
 * fetch shim that swallows the auto-runner kick, local echo server).
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import { NextRequest } from 'next/server';
import {
  ActionRegistry,
  httpActionHandler,
  reshapeActionHandler,
} from '@mediforce/core-actions';
import {
  WebhookRouter,
  WorkflowEngine,
} from '@mediforce/workflow-engine';
import {
  InMemoryAuditRepository,
  InMemoryCoworkSessionRepository,
  InMemoryHumanTaskRepository,
  InMemoryProcessInstanceRepository,
  InMemoryProcessRepository,
  parseWorkflowTemplate,
} from '@mediforce/platform-core';
import type { WorkflowDefinition } from '@mediforce/platform-core';
import { createEchoServer } from '../../../scripts/test-echo-server/server.js';

// Distinct port from execution-summaries-api so the two e2e files don't
// fight when run in the same vitest process (vitest.config.action-flows.ts
// runs all action-flow e2e files together).
const ECHO_PORT = 9097;
const ECHO_URL = `http://localhost:${ECHO_PORT}/anything`;

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEMPLATE_PATH = resolve(
  __dirname,
  '../../../apps/examples/personal-automations/src/food-log-proxy.wd.json',
);

const services = (() => {
  const processRepo = new InMemoryProcessRepository();
  const instanceRepo = new InMemoryProcessInstanceRepository();
  const auditRepo = new InMemoryAuditRepository();
  const humanTaskRepo = new InMemoryHumanTaskRepository();
  const coworkSessionRepo = new InMemoryCoworkSessionRepository();
  const engine = new WorkflowEngine(
    processRepo,
    instanceRepo,
    auditRepo,
    undefined,
    undefined,
    undefined,
    humanTaskRepo,
    coworkSessionRepo,
  );
  const actionRegistry = new ActionRegistry();
  actionRegistry.register('http', httpActionHandler);
  actionRegistry.register('reshape', reshapeActionHandler);
  const webhookRouter = new WebhookRouter(engine, processRepo);
  return {
    engine,
    processRepo,
    instanceRepo,
    auditRepo,
    humanTaskRepo,
    coworkSessionRepo,
    actionRegistry,
    webhookRouter,
  };
})();

vi.mock('@/lib/platform-services', () => ({
  getPlatformServices: () => services,
  getAppBaseUrl: () => 'http://localhost',
}));

vi.mock('@/app/actions/workflow-secrets', () => ({
  getWorkflowSecretsForRuntime: async () => ({}),
}));

const { POST: webhookPost } = await import(
  '@/app/api/triggers/webhook/[...path]/route'
);
const { POST: runPost } = await import('@/app/api/processes/[instanceId]/run/route');
const { GET: runsGet } = await import('@/app/api/runs/[runId]/route');

const realFetch = globalThis.fetch;

function installFetchShim(): void {
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input.toString();
    if (/\/api\/processes\/[^/]+\/run/.test(url)) {
      return new Response('{}', { status: 202 });
    }
    return realFetch(input, init);
  };
}

function restoreFetch(): void {
  globalThis.fetch = realFetch;
}

let echoServer: ReturnType<typeof createEchoServer>;
let originalApiKey: string | undefined;

beforeAll(async () => {
  originalApiKey = process.env.PLATFORM_API_KEY;
  process.env.PLATFORM_API_KEY = 'test-api-key';
  echoServer = createEchoServer();
  await new Promise<void>((res) => echoServer.listen(ECHO_PORT, () => res()));
});

afterAll(async () => {
  await new Promise<void>((res) => echoServer.close(() => res()));
  if (originalApiKey === undefined) {
    delete process.env.PLATFORM_API_KEY;
  } else {
    process.env.PLATFORM_API_KEY = originalApiKey;
  }
});

beforeEach(async () => {
  installFetchShim();

  const raw = JSON.parse(readFileSync(TEMPLATE_PATH, 'utf8'));
  const parsed = parseWorkflowTemplate(raw);
  if (!parsed.success) {
    throw new Error(
      `Template parse failed: ${parsed.error.issues.map((iss) => iss.message).join(', ')}`,
    );
  }
  const definition: WorkflowDefinition = {
    ...parsed.data,
    namespace: 'examples',
    version: 1,
    // Override the http step's URL so the proxy targets the local echo server
    // even when other tests change ECHO_PORT.
    steps: parsed.data.steps.map((step) => {
      if (step.executor !== 'action' || !step.action) return step;
      if (step.action.kind !== 'http') return step;
      return {
        ...step,
        action: {
          ...step.action,
          config: { ...step.action.config, url: ECHO_URL },
        },
      };
    }),
  };
  await services.processRepo.saveWorkflowDefinition(definition);
});

afterEach(() => {
  restoreFetch();
});

describe('food-log-proxy: webhook → http → reshape → polling', () => {
  it('chains two action steps and reshapes the upstream response', async () => {
    const payload = { meal: 'oats with spinach', kcal: 420 };
    const webhookReq = new NextRequest(
      'http://localhost/api/triggers/webhook/examples/food-log-proxy/food-log',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      },
    );

    const webhookRes = await webhookPost(webhookReq, {
      params: Promise.resolve({
        path: ['examples', 'food-log-proxy', 'food-log'],
      }),
    });
    expect(webhookRes.status).toBe(202);
    const webhookJson = (await webhookRes.json()) as { runId: string; statusUrl: string };
    expect(webhookJson.runId.length).toBeGreaterThan(0);

    const runReq = new NextRequest(
      `http://localhost/api/processes/${webhookJson.runId}/run`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ triggeredBy: 'webhook' }),
      },
    );
    await runPost(runReq, { params: Promise.resolve({ instanceId: webhookJson.runId }) });

    const deadline = Date.now() + 10_000;
    let polledStatus = 'unknown';
    let polledFinalOutput: unknown = null;
    while (Date.now() < deadline) {
      const pollReq = new NextRequest(
        `http://localhost/api/runs/${webhookJson.runId}`,
        { method: 'GET' },
      );
      const pollRes = await runsGet(pollReq, {
        params: Promise.resolve({ runId: webhookJson.runId }),
      });
      const pollJson = (await pollRes.json()) as {
        status: string;
        finalOutput: unknown;
      };
      polledStatus = pollJson.status;
      polledFinalOutput = pollJson.finalOutput;
      if (polledStatus === 'completed' || polledStatus === 'failed') break;
      await new Promise((r) => setTimeout(r, 50));
    }

    expect(polledStatus).toBe('completed');
    expect(polledFinalOutput).toEqual({
      proxyStatus: 200,
      echoedPayload: payload,
      echoedMethod: 'POST',
      source: 'food-log-proxy',
    });
  });
});
