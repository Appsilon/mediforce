/**
 * Spike #11 golden e2e: pogodynka — daily weather forecast workflow.
 *
 * What this validates beyond spike #9 / #10:
 *  - **Multi-action chain (4 actions)**: fetch-weather (http GET) → format
 *    (reshape) → push-pushover (http POST) → push-ntfy (http POST). Two
 *    parallel sinks downstream of one shape — variable propagation across
 *    a longer DAG.
 *  - **`${secrets.NAME}` interpolation** across url, body, and headers in
 *    real third-party API shapes (OpenWeatherMap, Pushover, ntfy.sh).
 *  - **Reshape with deep field access**: `steps.fetch-weather.body.json.list[0].weather[0].description`
 *    walks nested arrays + objects from a real-world response.
 *  - **Manual trigger path** (instead of webhook) — pogodynka's primary
 *    trigger is cron `0 6 * * *`; the e2e fires the parallel manual trigger
 *    through services.manualTrigger so the test stays deterministic without
 *    spinning the cron heartbeat.
 *
 * Mocks third-party HTTP endpoints via a fetch shim. Real registration on
 * staging will hit the actual APIs; the shim only intercepts the three
 * known prod hostnames.
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
  ManualTrigger,
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

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEMPLATE_PATH = resolve(
  __dirname,
  '../../../apps/examples/personal-automations/src/pogodynka.wd.json',
);

// ---- Canned third-party responses ------------------------------------------

const FAKE_OWM_FORECAST = {
  cod: '200',
  message: 0,
  cnt: 1,
  list: [
    {
      dt: 1745740800,
      main: { temp: 12.5, feels_like: 11.2, temp_min: 10, temp_max: 14, pressure: 1015, humidity: 65 },
      weather: [{ id: 803, main: 'Clouds', description: 'zachmurzenie umiarkowane', icon: '04d' }],
      clouds: { all: 60 },
      wind: { speed: 3.5, deg: 270 },
    },
  ],
  city: {
    id: 756135,
    name: 'Warsaw',
    coord: { lat: 52.2297, lon: 21.0122 },
    country: 'PL',
    population: 1702139,
    timezone: 7200,
  },
};

const FAKE_PUSHOVER_SUCCESS = { status: 1, request: 'pushover-req-123' };
// ntfy returns a JSON receipt with the published message metadata.
const FAKE_NTFY_RECEIPT = { id: 'ntfy-msg-456', time: 1745740800, expires: 1745912400, event: 'message', topic: 'filip' };

// ---- Wiring: in-memory services + handler glue -----------------------------

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
  const manualTrigger = new ManualTrigger(engine);
  return {
    engine,
    processRepo,
    instanceRepo,
    auditRepo,
    humanTaskRepo,
    coworkSessionRepo,
    actionRegistry,
    webhookRouter,
    manualTrigger,
  };
})();

vi.mock('@/lib/platform-services', () => ({
  getPlatformServices: () => services,
  getAppBaseUrl: () => 'http://localhost',
}));

vi.mock('@/app/actions/workflow-secrets', () => ({
  getWorkflowSecretsForRuntime: async () => ({
    OWM_KEY: 'test-owm-key-abc',
    PUSHOVER_TOKEN: 'test-pushover-token',
    PUSHOVER_USER: 'test-pushover-user',
    NTFY_TOPIC: 'filip-test',
  }),
}));

const { POST: runPost } = await import('@/app/api/processes/[instanceId]/run/route');
const { GET: runsGet } = await import('@/app/api/runs/[runId]/route');

// ---- fetch shim: intercept the three third-party hostnames -----------------
// Spike #9/#10 used a local echo server; pogodynka talks to three different
// shapes (OWM forecast, Pushover messages, ntfy publish). Easier to canned-
// response them here than to spin up shape-aware mock servers per host.

const realFetch = globalThis.fetch;
let capturedRequests: Array<{ url: string; method: string; body: unknown; headers: Record<string, unknown> }> = [];

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function installFetchShim(): void {
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input.toString();

    if (/\/api\/processes\/[^/]+\/run/.test(url)) {
      return new Response('{}', { status: 202 });
    }

    let parsedBody: unknown = init?.body;
    if (typeof init?.body === 'string') {
      try {
        parsedBody = JSON.parse(init.body);
      } catch {
        // keep as string
      }
    }
    capturedRequests.push({
      url,
      method: init?.method ?? 'GET',
      body: parsedBody,
      headers: (init?.headers as Record<string, unknown>) ?? {},
    });

    if (url.includes('api.openweathermap.org/data/2.5/forecast')) {
      return jsonResponse(FAKE_OWM_FORECAST);
    }
    if (url.includes('api.pushover.net/1/messages.json')) {
      return jsonResponse(FAKE_PUSHOVER_SUCCESS);
    }
    if (url.includes('ntfy.sh/')) {
      return jsonResponse(FAKE_NTFY_RECEIPT);
    }

    return realFetch(input, init);
  };
}

function restoreFetch(): void {
  globalThis.fetch = realFetch;
}

// ---- Lifecycle -------------------------------------------------------------

beforeAll(() => {
  // No external server to start — fetch shim covers all third-party calls.
});

afterAll(() => {
  // Nothing to tear down.
});

beforeEach(async () => {
  capturedRequests = [];
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
    namespace: 'filip',
    version: 1,
  };
  await services.processRepo.saveWorkflowDefinition(definition);
});

afterEach(() => {
  restoreFetch();
});

// ---- The golden test --------------------------------------------------------

describe('spike #11: pogodynka — fetch → reshape → push×2 → terminal', () => {
  it('runs end-to-end via manual trigger and pushes weather to Pushover + ntfy', async () => {
    // Fire via manual trigger (parallel to cron daily-6am). Manual trigger is
    // declared in the workflow alongside cron so e2e + ad-hoc human runs
    // share the same engine path.
    const triggerResult = await services.manualTrigger.fireWorkflow({
      definitionName: 'pogodynka',
      definitionVersion: 1,
      triggerName: 'test',
      triggeredBy: 'spike-11-test',
    });
    const runId = triggerResult.instanceId;

    // Drive the auto-runner directly — same pattern as spike #9/#10. The
    // route handler uses the mocked platform-services + workflow-secrets,
    // so secrets interpolation runs against the test's canned bag.
    const runReq = new NextRequest(
      `http://localhost/api/processes/${runId}/run`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ triggeredBy: 'spike-11-test' }),
      },
    );
    await runPost(runReq, { params: Promise.resolve({ instanceId: runId }) });

    // Poll up to 10s — auto-runner is synchronous so this should hit on the
    // first iteration.
    const deadline = Date.now() + 10_000;
    let polledStatus = 'unknown';
    let polledFinalOutput: unknown = null;
    while (Date.now() < deadline) {
      const pollReq = new NextRequest(
        `http://localhost/api/runs/${runId}`,
        { method: 'GET' },
      );
      const pollRes = await runsGet(pollReq, { params: Promise.resolve({ runId }) });
      const pollJson = (await pollRes.json()) as { status: string; finalOutput: unknown };
      polledStatus = pollJson.status;
      polledFinalOutput = pollJson.finalOutput;
      if (polledStatus === 'completed' || polledStatus === 'failed') break;
      await new Promise((r) => setTimeout(r, 50));
    }

    expect(polledStatus).toBe('completed');

    // The final completed step is push-ntfy (its http output sits last in
    // the execution log). Asserting against ntfy keeps the assertion
    // close to the actual finalOutput surface.
    const finalOutput = polledFinalOutput as {
      status: number;
      url: string;
      method: string;
      body: { json: typeof FAKE_NTFY_RECEIPT };
    };
    expect(finalOutput.status).toBe(200);
    expect(finalOutput.method).toBe('POST');
    expect(finalOutput.url).toBe('https://ntfy.sh/filip-test');
    expect(finalOutput.body.json).toEqual(FAKE_NTFY_RECEIPT);

    // Cross-check that all 3 third-party calls fired in order with the
    // expected secrets-interpolated payload.
    const owmRequest = capturedRequests.find((r) => r.url.includes('openweathermap'));
    expect(owmRequest, 'OpenWeatherMap call missing').toBeDefined();
    expect(owmRequest!.url).toBe(
      'https://api.openweathermap.org/data/2.5/forecast?q=Warsaw,PL&units=metric&lang=pl&appid=test-owm-key-abc',
    );

    const pushoverRequest = capturedRequests.find((r) => r.url.includes('pushover'));
    expect(pushoverRequest, 'Pushover call missing').toBeDefined();
    expect(pushoverRequest!.method).toBe('POST');
    expect(pushoverRequest!.body).toEqual({
      token: 'test-pushover-token',
      user: 'test-pushover-user',
      title: 'Pogodynka Warsaw',
      message: 'zachmurzenie umiarkowane, 12.5°C (feels 11.2°C)',
    });

    const ntfyRequest = capturedRequests.find((r) => r.url.includes('ntfy.sh'));
    expect(ntfyRequest, 'ntfy call missing').toBeDefined();
    expect(ntfyRequest!.url).toBe('https://ntfy.sh/filip-test');
    expect(ntfyRequest!.body).toBe('zachmurzenie umiarkowane, 12.5°C (feels 11.2°C)');
    expect((ntfyRequest!.headers as Record<string, string>).Title).toBe('Pogodynka Warsaw');
    expect((ntfyRequest!.headers as Record<string, string>).Tags).toBe('sun_with_face');
  });
});
