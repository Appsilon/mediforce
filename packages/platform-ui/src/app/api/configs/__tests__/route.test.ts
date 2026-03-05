import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ProcessConfig } from '@mediforce/platform-core';

// ---- Mocks ----

const mockListProcessConfigs = vi.fn();
const mockSaveProcessConfig = vi.fn();
const mockGetProcessDefinition = vi.fn();
const mockPluginList = vi.fn().mockReturnValue([]);

vi.mock('@/lib/platform-services', () => ({
  getPlatformServices: () => ({
    processRepo: {
      listProcessConfigs: mockListProcessConfigs,
      saveProcessConfig: mockSaveProcessConfig,
      getProcessDefinition: mockGetProcessDefinition,
    },
    pluginRegistry: {
      list: mockPluginList,
    },
  }),
}));

// Mock validateProcessConfig
const mockValidateProcessConfig = vi.fn().mockReturnValue({ valid: true, errors: [], warnings: [] });
vi.mock('@mediforce/platform-core', async () => {
  const actual = await vi.importActual<typeof import('@mediforce/platform-core')>('@mediforce/platform-core');
  return {
    ...actual,
    validateProcessConfig: (...args: unknown[]) => mockValidateProcessConfig(...args),
  };
});

import { GET, POST } from '../route';

// ---- Helpers ----

function makeGetRequest(params?: Record<string, string>): Request {
  const url = new URL('http://localhost/api/configs');
  if (params) {
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  }
  return new Request(url.toString());
}

function makePostRequest(body: unknown): Request {
  return new Request('http://localhost/api/configs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const validConfig: ProcessConfig = {
  processName: 'supply-chain-review',
  configName: 'default',
  configVersion: '1.0',
  stepConfigs: [
    { stepId: 'intake', executorType: 'human' },
  ],
};

// ---- Tests ----

describe('GET /api/configs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('[DATA] returns configs filtered by processName', async () => {
    mockListProcessConfigs.mockResolvedValue([validConfig]);

    const res = await GET(makeGetRequest({ processName: 'supply-chain-review' }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.configs).toHaveLength(1);
    expect(json.configs[0].processName).toBe('supply-chain-review');
    expect(mockListProcessConfigs).toHaveBeenCalledWith('supply-chain-review');
  });

  it('[DATA] returns empty array for nonexistent process', async () => {
    mockListProcessConfigs.mockResolvedValue([]);

    const res = await GET(makeGetRequest({ processName: 'nonexistent' }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.configs).toEqual([]);
  });

  it('[ERROR] returns 400 when processName is missing', async () => {
    const res = await GET(makeGetRequest());

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBeDefined();
  });
});

describe('POST /api/configs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockValidateProcessConfig.mockReturnValue({ valid: true, errors: [], warnings: [] });
    mockGetProcessDefinition.mockResolvedValue({
      name: 'supply-chain-review',
      version: '1.0',
      steps: [{ id: 'intake', name: 'Intake', type: 'creation' }],
      triggers: [],
    });
    mockPluginList.mockReturnValue([{ name: 'plugin-a' }]);
  });

  it('[DATA] saves valid config and returns 201', async () => {
    mockSaveProcessConfig.mockResolvedValue(undefined);

    const res = await POST(makePostRequest(validConfig));

    expect(res.status).toBe(201);
    expect(mockSaveProcessConfig).toHaveBeenCalledWith(validConfig);
  });

  it('[ERROR] returns 400 for invalid body', async () => {
    const res = await POST(makePostRequest({ processName: '' }));

    expect(res.status).toBe(400);
  });

  it('[ERROR] returns 409 for duplicate config version', async () => {
    const { ConfigVersionAlreadyExistsError } = await import('@mediforce/platform-infra');
    mockSaveProcessConfig.mockRejectedValue(
      new ConfigVersionAlreadyExistsError('supply-chain-review', 'default', '1.0'),
    );

    const res = await POST(makePostRequest(validConfig));
    const json = await res.json();

    expect(res.status).toBe(409);
    expect(json.error).toContain('already exists');
  });

  it('[ERROR] returns 400 when validation has errors', async () => {
    mockValidateProcessConfig.mockReturnValue({
      valid: false,
      errors: ['Missing StepConfig for step \'review\''],
      warnings: [],
    });

    const res = await POST(makePostRequest(validConfig));
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.errors).toBeDefined();
  });

  it('[DATA] runs validateProcessConfig server-side before saving', async () => {
    mockSaveProcessConfig.mockResolvedValue(undefined);

    await POST(makePostRequest(validConfig));

    expect(mockValidateProcessConfig).toHaveBeenCalled();
  });
});
