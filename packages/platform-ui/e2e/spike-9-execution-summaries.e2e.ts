/**
 * Spike #9 golden e2e: webhook → http action → polling → echo round-trip.
 *
 * What this test owns (decision boundaries):
 *  - Validates the full request lifecycle through the real Next.js handlers
 *    (catch-all webhook POST, auto-runner POST, runs GET).
 *  - Validates the WorkflowTemplate loader — JSON file without namespace,
 *    namespace injected at registration.
 *  - Validates http action interpolation against `triggerPayload.body`.
 *  - Validates the echo round-trip via a real local Node HTTP server (no
 *    httpbin, no network).
 *
 * What this test deliberately skips:
 *  - Firebase: in-memory repos via vi.mock'd platform-services.
 *  - Auto-runner kick: the catch-all webhook handler does a fire-and-forget
 *    `fetch(<baseUrl>/api/processes/<id>/run)`. The test mocks global fetch
 *    so that internal hop calls the run handler synchronously instead of
 *    leaving an open socket; outbound fetch to the echo server still works.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import { NextRequest } from 'next/server';
import {
  ActionRegistry,
  httpActionHandler,
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

// ---- Wiring: in-memory services + handler glue -----------------------------

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEMPLATE_PATH = resolve(
  __dirname,
  '../../../apps/examples/personal-automations/src/execution-summaries-api.wd.json',
);

const ECHO_PORT = 9098;
const ECHO_URL = `http://localhost:${ECHO_PORT}/anything`;

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

// The auto-runner's env-validation pre-flight reaches into Firestore via
// the workflow-secrets server action. Spike workflow declares no env, so
// skipping the lookup is safe — return an empty record.
vi.mock('@/app/actions/workflow-secrets', () => ({
  getWorkflowSecretsForRuntime: async () => ({}),
}));

// Imported AFTER vi.mock so handlers receive the in-memory services.
const { POST: webhookPost } = await import(
  '@/app/api/triggers/webhook/[...path]/route'
);
const { POST: runPost } = await import('@/app/api/processes/[instanceId]/run/route');
const { GET: runsGet } = await import('@/app/api/runs/[runId]/route');

// ---- fetch shim: route the auto-runner kick to the in-process handler ------
//
// The catch-all webhook route does a fire-and-forget POST to
// /api/processes/<id>/run. In a real deploy that hits the live server; in
// the test we want the call to drive the real run handler in-process so the
// test can deterministically poll afterwards. Outbound fetches to the echo
// server (localhost:9098) pass through unchanged.

const realFetch = globalThis.fetch;

function installFetchShim(): void {
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input.toString();
    if (/\/api\/processes\/[^/]+\/run/.test(url)) {
      // Swallow the fire-and-forget auto-runner kick from the catch-all
      // webhook route. The test drives runPost directly below so the
      // assertion is deterministic and we don't double-execute the loop.
      return new Response('{}', { status: 202 });
    }
    return realFetch(input, init);
  };
}

function restoreFetch(): void {
  globalThis.fetch = realFetch;
}

// ---- Lifecycle -------------------------------------------------------------

let echoServer: ReturnType<typeof createEchoServer>;

beforeAll(async () => {
  echoServer = createEchoServer();
  await new Promise<void>((res) => echoServer.listen(ECHO_PORT, () => res()));
});

afterAll(async () => {
  await new Promise<void>((res) => echoServer.close(() => res()));
});

beforeEach(async () => {
  installFetchShim();

  // Register the workflow template per decision K — namespace is injected
  // at registration; the file itself stays tenant-agnostic.
  const raw = JSON.parse(readFileSync(TEMPLATE_PATH, 'utf8'));
  const parsed = parseWorkflowTemplate(raw);
  if (!parsed.success) {
    throw new Error(
      `Template parse failed: ${parsed.error.issues.map((iss) => iss.message).join(', ')}`,
    );
  }
  const definition: WorkflowDefinition = {
    ...parsed.data,
    namespace: 'filip',
    version: 1,
    // Override the URL so the workflow targets the local echo server even
    // when other tests change ECHO_PORT.
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

// ---- The golden test --------------------------------------------------------

describe('spike #9: webhook → http action → polling → echo round-trip', () => {
  it('completes a webhook-driven workflow end-to-end with echoed payload', async () => {
    const payload = { hello: 'filip', greeting: 'caveman' };
    const webhookReq = new NextRequest(
      'http://localhost/api/triggers/webhook/filip/execution-summaries-api/execution-summaries',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      },
    );

    const webhookRes = await webhookPost(webhookReq, {
      params: Promise.resolve({
        path: ['filip', 'execution-summaries-api', 'execution-summaries'],
      }),
    });
    expect(webhookRes.status).toBe(202);
    const webhookJson = (await webhookRes.json()) as { runId: string; statusUrl: string };
    expect(webhookJson.runId.length).toBeGreaterThan(0);
    expect(webhookJson.statusUrl).toBe(`/api/runs/${webhookJson.runId}`);

    // Drive the auto-runner directly. In production the catch-all webhook
    // route fire-and-forgets to /api/processes/<id>/run; here we invoke
    // the same handler synchronously so the test polling loop is
    // deterministic.
    const runReq = new NextRequest(
      `http://localhost/api/processes/${webhookJson.runId}/run`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ triggeredBy: 'webhook' }),
      },
    );
    await runPost(runReq, { params: Promise.resolve({ instanceId: webhookJson.runId }) });

    // Poll up to 10s for completion (paranoia margin — auto-runner just ran
    // synchronously above, so completion is already in place).
    const deadline = Date.now() + 10_000;
    let polledStatus = 'unknown';
    let polledFinalOutput: unknown = null;
    while (Date.now() < deadline) {
      const runReq = new NextRequest(
        `http://localhost/api/runs/${webhookJson.runId}`,
        { method: 'GET' },
      );
      const runRes = await runsGet(runReq, {
        params: Promise.resolve({ runId: webhookJson.runId }),
      });
      const runJson = (await runRes.json()) as {
        status: string;
        finalOutput: unknown;
      };
      polledStatus = runJson.status;
      polledFinalOutput = runJson.finalOutput;
      if (polledStatus === 'completed' || polledStatus === 'failed') break;
      await new Promise((r) => setTimeout(r, 50));
    }

    expect(polledStatus).toBe('completed');
    expect(polledFinalOutput).not.toBeNull();
    const finalOutput = polledFinalOutput as {
      status: number;
      body: { json: { json: Record<string, unknown> } };
    };
    expect(finalOutput.status).toBe(200);
    // The echo server returns { method, json, headers, ... }; the http
    // action wraps that under body.json. So the original payload is at
    // finalOutput.body.json.json.
    expect(finalOutput.body.json.json).toEqual(payload);
  });
});
