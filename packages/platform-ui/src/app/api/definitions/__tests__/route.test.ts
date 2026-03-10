import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---- Mocks ----

const mockSaveProcessDefinition = vi.fn();
const mockGetProcessConfig = vi.fn();
const mockSaveProcessConfig = vi.fn();
const mockValidateApiKey = vi.fn();

vi.mock('@/lib/platform-services', () => ({
  getPlatformServices: () => ({
    processRepo: {
      saveProcessDefinition: mockSaveProcessDefinition,
      getProcessConfig: mockGetProcessConfig,
      saveProcessConfig: mockSaveProcessConfig,
    },
  }),
  validateApiKey: (...args: unknown[]) => mockValidateApiKey(...args),
}));

vi.mock('@mediforce/platform-infra', async () => {
  const actual = await vi.importActual<typeof import('@mediforce/platform-infra')>('@mediforce/platform-infra');
  return { ...actual };
});

import { PUT } from '../route';

// ---- Helpers ----

const validYaml = `
name: protocol-to-tfl
version: "1"
triggers:
  - name: manual
    type: manual
steps:
  - id: upload-documents
    name: Upload Documents
    type: creation
    ui:
      component: file-upload
      config:
        acceptedTypes:
          - application/pdf
        minFiles: 1
        maxFiles: 5
  - id: extract-metadata
    name: Extract Metadata
    type: creation
  - id: review-metadata
    name: Review Metadata
    type: review
  - id: done
    name: Done
    type: terminal
transitions:
  - from: upload-documents
    to: extract-metadata
  - from: extract-metadata
    to: review-metadata
  - from: review-metadata
    to: done
`;

function makePutRequest(body: string, apiKey?: string): Request {
  const headers: Record<string, string> = { 'Content-Type': 'text/yaml' };
  if (apiKey) headers['X-Api-Key'] = apiKey;
  return new Request('http://localhost/api/definitions', {
    method: 'PUT',
    headers,
    body,
  });
}

// ---- Tests ----

describe('PUT /api/definitions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockValidateApiKey.mockReturnValue(true);
    mockSaveProcessDefinition.mockResolvedValue(undefined);
    mockGetProcessConfig.mockResolvedValue(null);
    mockSaveProcessConfig.mockResolvedValue(undefined);
  });

  it('[AUTH] returns 401 when API key is invalid', async () => {
    mockValidateApiKey.mockReturnValue(false);

    const res = await PUT(makePutRequest(validYaml));
    const json = await res.json();

    expect(res.status).toBe(401);
    expect(json.error).toBe('Unauthorized');
  });

  it('[DATA] saves valid YAML definition and returns 201', async () => {
    const res = await PUT(makePutRequest(validYaml, 'valid-key'));
    const json = await res.json();

    expect(res.status).toBe(201);
    expect(json.success).toBe(true);
    expect(json.name).toBe('protocol-to-tfl');
    expect(json.version).toBe('1');
    expect(mockSaveProcessDefinition).toHaveBeenCalledTimes(1);
  });

  it('[DATA] auto-creates all-human config when none exists', async () => {
    mockGetProcessConfig.mockResolvedValue(null);

    await PUT(makePutRequest(validYaml, 'valid-key'));

    expect(mockSaveProcessConfig).toHaveBeenCalledTimes(1);
    const savedConfig = mockSaveProcessConfig.mock.calls[0][0];
    expect(savedConfig.processName).toBe('protocol-to-tfl');
    expect(savedConfig.configName).toBe('all-human');
    expect(savedConfig.stepConfigs.every(
      (sc: { executorType: string }) => sc.executorType === 'human',
    )).toBe(true);
  });

  it('[DATA] skips config creation when all-human config already exists', async () => {
    mockGetProcessConfig.mockResolvedValue({ configName: 'all-human' });

    await PUT(makePutRequest(validYaml, 'valid-key'));

    expect(mockSaveProcessConfig).not.toHaveBeenCalled();
  });

  it('[ERROR] returns 400 for empty body', async () => {
    const res = await PUT(makePutRequest('', 'valid-key'));
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toBeDefined();
  });

  it('[ERROR] returns 400 for invalid YAML', async () => {
    const res = await PUT(makePutRequest('not: valid: yaml: {{', 'valid-key'));
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toBeDefined();
  });

  it('[ERROR] returns 400 for YAML that fails schema validation', async () => {
    const invalidYaml = `
name: test
version: "1"
steps: []
`;
    const res = await PUT(makePutRequest(invalidYaml, 'valid-key'));
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toBeDefined();
  });

  it('[ERROR] returns 409 when definition version already exists', async () => {
    const { DefinitionVersionAlreadyExistsError } = await import('@mediforce/platform-infra');
    mockSaveProcessDefinition.mockRejectedValue(
      new DefinitionVersionAlreadyExistsError('protocol-to-tfl', '1'),
    );

    const res = await PUT(makePutRequest(validYaml, 'valid-key'));
    const json = await res.json();

    expect(res.status).toBe(409);
    expect(json.error).toContain('already exists');
  });
});
