import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// Route smoke — handler behaviour is covered in
// `packages/platform-api/src/handlers/processes/__tests__/list-audit-events.test.ts`.
// What matters here is that the Next.js route wires the schema, services,
// and handler together, and that the response shape matches the contract
// (`{ events }` — wrapped so future pagination stays additive).

const mockGetByProcess = vi.fn();

vi.mock('@/lib/platform-services', () => ({
  getPlatformServices: () => ({
    auditRepo: { getByProcess: mockGetByProcess },
  }),
}));

import { GET } from '../route';

function makeRequest(instanceId: string) {
  const req = new NextRequest(
    `http://localhost/api/processes/${instanceId}/audit`,
    { headers: { 'X-Api-Key': 'test-key' } },
  );
  return { req, params: Promise.resolve({ instanceId }) };
}

describe('GET /api/processes/[instanceId]/audit — route smoke', () => {
  beforeEach(() => {
    mockGetByProcess.mockReset();
  });

  it('wraps events in { events } and calls the repo with the instanceId', async () => {
    const events = [
      { action: 'step.started', timestamp: '2026-03-12T10:00:00Z', processInstanceId: 'inst-001' },
      { action: 'step.completed', timestamp: '2026-03-12T10:01:00Z', processInstanceId: 'inst-001' },
    ];
    mockGetByProcess.mockResolvedValue(events);
    const { req, params } = makeRequest('inst-001');

    const res = await GET(req, { params });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ events });
    expect(mockGetByProcess).toHaveBeenCalledWith('inst-001');
  });

  it('returns { events: [] } when no audit events exist', async () => {
    mockGetByProcess.mockResolvedValue([]);
    const { req, params } = makeRequest('inst-999');

    const res = await GET(req, { params });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ events: [] });
  });
});
