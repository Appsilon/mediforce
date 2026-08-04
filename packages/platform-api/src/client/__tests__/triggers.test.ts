import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Mediforce } from '../index';

/**
 * The client builds each request body by hand, so a field can be declared on the
 * contract, honoured by the handler, and still never reach the wire. That is
 * exactly how the cron static payload (ADR-0012) shipped broken: `create` and
 * `update` both dropped `payload`, which made the whole per-row payload feature
 * unreachable from the UI and from `mediforce workflow trigger --payload`, while
 * every handler-level test stayed green because it bypassed the client.
 *
 * These assert on the outgoing body rather than a live server — the gap was
 * between `CreateTriggerInputSchema.parse` and `fetch`, and nothing else.
 */

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const TEST_BASE_URL = 'http://localhost';

const NOW = '2026-07-31T11:27:31.759Z';

/** A cron trigger resource as the server actually returns it, so the client's
 *  response parsing is exercised too rather than stubbed around. */
function cronTriggerResponse(payload?: Record<string, unknown>) {
  return {
    namespace: 'test',
    workflowName: 'Cron Payload Test',
    name: 'nightly',
    enabled: true,
    createdAt: NOW,
    updatedAt: NOW,
    type: 'cron',
    config: { schedule: '0 3 * * *', ...(payload === undefined ? {} : { payload }) },
    lastTriggeredAt: NOW,
  };
}

/** The JSON body the client actually sent on its first request. */
function sentBody(fetchSpy: ReturnType<typeof vi.spyOn>): Record<string, unknown> {
  const init = fetchSpy.mock.calls[0]?.[1] as RequestInit | undefined;
  return JSON.parse(String(init?.body)) as Record<string, unknown>;
}

describe('mediforce.triggers.create', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("sends the cron row's static payload in the request body", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        jsonResponse({ trigger: cronTriggerResponse({ studyId: 'STUDY-A' }), webhookUrl: null }),
      );

    const mediforce = new Mediforce({ apiKey: 'k', baseUrl: TEST_BASE_URL });
    await mediforce.triggers.create({
      namespace: 'test',
      definitionName: 'Cron Payload Test',
      triggerName: 'nightly',
      type: 'cron',
      schedule: '0 3 * * *',
      payload: { studyId: 'STUDY-A' },
      enabled: true,
    });

    // The whole point: the payload the caller authored is on the wire. Without
    // it the server sees a payload-less row and rejects the write outright on a
    // workflow whose triggerInput has a required field.
    expect(sentBody(fetchSpy).payload).toEqual({ studyId: 'STUDY-A' });
  });

  it('omits payload entirely when the caller passes none', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(jsonResponse({ trigger: cronTriggerResponse(), webhookUrl: null }));

    const mediforce = new Mediforce({ apiKey: 'k', baseUrl: TEST_BASE_URL });
    await mediforce.triggers.create({
      namespace: 'test',
      definitionName: 'Cron Payload Test',
      triggerName: 'nightly',
      type: 'cron',
      schedule: '0 3 * * *',
      enabled: true,
    });

    // Absent, not `null` — the handler reads `input.payload === undefined` as
    // "no payload", and a serialized null would not be that.
    expect('payload' in sentBody(fetchSpy)).toBe(false);
  });
});

describe('mediforce.triggers.update', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("sends the edited payload so a row's static input can be changed in place", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        jsonResponse({ trigger: cronTriggerResponse({ studyId: 'STUDY-A2' }) }),
      );

    const mediforce = new Mediforce({ apiKey: 'k', baseUrl: TEST_BASE_URL });
    await mediforce.triggers.update({
      namespace: 'test',
      definitionName: 'Cron Payload Test',
      triggerName: 'nightly',
      schedule: '0 3 * * *',
      payload: { studyId: 'STUDY-A2' },
    });

    // Dropping this silently discarded the edit while still reporting success —
    // the handler saw only a schedule and left the stored payload untouched.
    expect(sentBody(fetchSpy).payload).toEqual({ studyId: 'STUDY-A2' });
  });

  it('sends an empty payload as a payload, because `{}` clears the static input', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(jsonResponse({ trigger: cronTriggerResponse() }));

    const mediforce = new Mediforce({ apiKey: 'k', baseUrl: TEST_BASE_URL });
    await mediforce.triggers.update({
      namespace: 'test',
      definitionName: 'Cron Payload Test',
      triggerName: 'nightly',
      payload: {},
    });

    // `payload: {}` is documented as "clear the payload" and is distinct from
    // omission, so it has to survive serialization rather than be pruned.
    expect(sentBody(fetchSpy).payload).toEqual({});
  });
});
