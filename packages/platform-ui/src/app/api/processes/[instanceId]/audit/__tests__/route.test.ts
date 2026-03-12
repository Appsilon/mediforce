import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGetByProcess = vi.fn();

vi.mock('@/lib/platform-services', () => ({
  validateApiKey: vi.fn(() => true),
  getPlatformServices: () => ({
    auditRepo: { getByProcess: mockGetByProcess },
  }),
}));

import { GET } from '../route';
import { validateApiKey } from '@/lib/platform-services';

const mockValidateApiKey = vi.mocked(validateApiKey);

function makeRequest(instanceId: string) {
  const req = new Request(`http://localhost/api/processes/${instanceId}/audit`, {
    headers: { 'X-Api-Key': 'test-key' },
  });
  return { req, params: Promise.resolve({ instanceId }) };
}

describe('GET /api/processes/[instanceId]/audit', () => {
  beforeEach(() => {
    mockGetByProcess.mockReset();
    mockValidateApiKey.mockReturnValue(true);
  });

  it('[AUTH] returns 401 when API key is invalid', async () => {
    mockValidateApiKey.mockReturnValue(false);
    const { req, params } = makeRequest('inst-001');

    const res = await GET(req, { params });

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe('Unauthorized');
  });

  it('[DATA] returns audit events for a process instance', async () => {
    const events = [
      { action: 'step.started', timestamp: '2026-03-12T10:00:00Z', processInstanceId: 'inst-001' },
      { action: 'step.completed', timestamp: '2026-03-12T10:01:00Z', processInstanceId: 'inst-001' },
    ];
    mockGetByProcess.mockResolvedValue(events);
    const { req, params } = makeRequest('inst-001');

    const res = await GET(req, { params });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual(events);
    expect(mockGetByProcess).toHaveBeenCalledWith('inst-001');
  });

  it('[DATA] returns empty array when no audit events exist', async () => {
    mockGetByProcess.mockResolvedValue([]);
    const { req, params } = makeRequest('inst-999');

    const res = await GET(req, { params });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual([]);
  });

  it('[ERROR] returns 500 when repository throws', async () => {
    mockGetByProcess.mockRejectedValue(new Error('Firestore unavailable'));
    const { req, params } = makeRequest('inst-001');

    const res = await GET(req, { params });

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe('Firestore unavailable');
  });
});
