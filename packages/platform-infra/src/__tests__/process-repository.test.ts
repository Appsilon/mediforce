import { describe, it, expect, beforeEach, vi } from 'vitest';
import { InMemoryProcessRepository } from '@mediforce/platform-core';
import type {
  ProcessDefinition,
  ProcessConfig,
} from '@mediforce/platform-core';
import {
  FirestoreProcessRepository,
  ConfigVersionAlreadyExistsError,
} from '../firestore/process-repository.js';

function createTestDefinition(
  overrides: Partial<ProcessDefinition> = {},
): ProcessDefinition {
  return {
    name: 'supply-chain-review',
    version: '1.0.0',
    description: 'Supply chain review process',
    steps: [
      {
        id: 'intake',
        name: 'Intake',
        type: 'creation',
      },
      {
        id: 'review',
        name: 'Review',
        type: 'review',
        verdicts: {
          approve: { target: 'complete' },
          reject: { target: 'intake' },
        },
      },
      {
        id: 'complete',
        name: 'Complete',
        type: 'terminal',
      },
    ],
    transitions: [
      { from: 'intake', to: 'review' },
      { from: 'review', to: 'complete' },
    ],
    triggers: [{ type: 'manual', name: 'start-review' }],
    ...overrides,
  };
}

function createTestConfig(
  overrides: Partial<ProcessConfig> = {},
): ProcessConfig {
  return {
    processName: 'supply-chain-review',
    configName: 'default',
    configVersion: '1.0.0',
    stepConfigs: [
      {
        stepId: 'review',
        executorType: 'human' as const,
        autonomyLevel: 'L2' as const,
        fallbackBehavior: 'escalate_to_human' as const,
        timeoutMinutes: 60,
        reviewConstraints: {
          maxIterations: 3,
          timeBoxDays: 5,
        },
      },
    ],
    ...overrides,
  };
}

describe('InMemoryProcessRepository', () => {
  let repo: InMemoryProcessRepository;

  beforeEach(() => {
    repo = new InMemoryProcessRepository();
  });

  describe('ProcessDefinition', () => {
    it('saveProcessDefinition + getProcessDefinition round-trip works', async () => {
      const definition = createTestDefinition();
      await repo.saveProcessDefinition(definition);

      const result = await repo.getProcessDefinition(
        definition.name,
        definition.version,
      );
      expect(result).toEqual(definition);
    });

    it('getProcessDefinition returns null for non-existent', async () => {
      const result = await repo.getProcessDefinition(
        'nonexistent',
        '1.0.0',
      );
      expect(result).toBeNull();
    });

    // Immutability note: FirestoreProcessRepository enforces immutability (throws on duplicate name:version).
    // InMemoryProcessRepository allows overwrite for test convenience.
    it('overwrites existing definition with same name:version', async () => {
      const original = createTestDefinition({
        description: 'Original',
      });
      await repo.saveProcessDefinition(original);

      const updated = createTestDefinition({
        description: 'Updated',
      });
      await repo.saveProcessDefinition(updated);

      const result = await repo.getProcessDefinition(
        'supply-chain-review',
        '1.0.0',
      );
      expect(result?.description).toBe('Updated');
    });

    it('stores different versions independently', async () => {
      const v1 = createTestDefinition({ version: '1.0.0' });
      const v2 = createTestDefinition({
        version: '2.0.0',
        description: 'Version 2',
      });

      await repo.saveProcessDefinition(v1);
      await repo.saveProcessDefinition(v2);

      const resultV1 = await repo.getProcessDefinition(
        'supply-chain-review',
        '1.0.0',
      );
      const resultV2 = await repo.getProcessDefinition(
        'supply-chain-review',
        '2.0.0',
      );

      expect(resultV1?.version).toBe('1.0.0');
      expect(resultV2?.version).toBe('2.0.0');
      expect(resultV2?.description).toBe('Version 2');
    });
  });

  describe('ProcessConfig', () => {
    it('saveProcessConfig + getProcessConfig round-trip works', async () => {
      const config = createTestConfig();
      await repo.saveProcessConfig(config);

      const result = await repo.getProcessConfig(
        config.processName,
        config.configName,
        config.configVersion,
      );
      expect(result).toEqual(config);
    });

    it('getProcessConfig returns null for non-existent', async () => {
      const result = await repo.getProcessConfig(
        'nonexistent',
        'default',
        '1.0.0',
      );
      expect(result).toBeNull();
    });

    it('[DATA] overwriting a config in InMemory succeeds (test convenience)', async () => {
      const original = createTestConfig();
      await repo.saveProcessConfig(original);

      const updated = createTestConfig({
        stepConfigs: [
          { stepId: 'review', executorType: 'agent' as const, plugin: 'gpt-reviewer' },
        ],
      });
      await repo.saveProcessConfig(updated);

      const result = await repo.getProcessConfig('supply-chain-review', 'default', '1.0.0');
      expect(result?.stepConfigs[0].executorType).toBe('agent');
      expect(result?.stepConfigs[0].plugin).toBe('gpt-reviewer');
    });

    it('[DATA] different configName with same processName stores separately', async () => {
      const configA = createTestConfig({ configName: 'fast-track' });
      const configB = createTestConfig({ configName: 'full-review' });

      await repo.saveProcessConfig(configA);
      await repo.saveProcessConfig(configB);

      const resultA = await repo.getProcessConfig('supply-chain-review', 'fast-track', '1.0.0');
      const resultB = await repo.getProcessConfig('supply-chain-review', 'full-review', '1.0.0');

      expect(resultA).toBeDefined();
      expect(resultB).toBeDefined();
      expect(resultA).not.toEqual(resultB);
      expect(repo.count().configs).toBe(2);
    });

    it('[DATA] compositeKey format is {processName}:{configName}:{configVersion}', async () => {
      const config = createTestConfig({
        processName: 'test-proc',
        configName: 'staging',
        configVersion: '2.0',
      });
      await repo.saveProcessConfig(config);

      // Verify the 3-part key works for retrieval
      const result = await repo.getProcessConfig('test-proc', 'staging', '2.0');
      expect(result).toEqual(config);

      // Verify a different configVersion is stored separately
      const configV3 = createTestConfig({
        processName: 'test-proc',
        configName: 'staging',
        configVersion: '3.0',
      });
      await repo.saveProcessConfig(configV3);
      const resultV3 = await repo.getProcessConfig('test-proc', 'staging', '3.0');
      expect(resultV3?.configVersion).toBe('3.0');
      expect(repo.count().configs).toBe(2);
    });
  });

  describe('helper methods', () => {
    it('count returns correct counts', async () => {
      expect(repo.count()).toEqual({ definitions: 0, configs: 0 });

      await repo.saveProcessDefinition(createTestDefinition());
      await repo.saveProcessConfig(createTestConfig());

      expect(repo.count()).toEqual({ definitions: 1, configs: 1 });
    });

    it('clear removes all stored data', async () => {
      await repo.saveProcessDefinition(createTestDefinition());
      await repo.saveProcessConfig(createTestConfig());

      repo.clear();
      expect(repo.count()).toEqual({ definitions: 0, configs: 0 });
    });
  });
});

// Hoisted mocks must be defined before vi.mock
const { mockGetDoc, mockSetDoc, mockDoc } = vi.hoisted(() => ({
  mockGetDoc: vi.fn(),
  mockSetDoc: vi.fn(),
  mockDoc: vi.fn(),
}));

vi.mock('firebase/firestore', () => ({
  doc: (...args: unknown[]) => mockDoc(...args),
  getDoc: (...args: unknown[]) => mockGetDoc(...args),
  setDoc: (...args: unknown[]) => mockSetDoc(...args),
}));

describe('FirestoreProcessRepository - config immutability', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockDoc.mockReturnValue('mock-doc-ref');
    mockSetDoc.mockResolvedValue(undefined);
  });

  function createFirestoreRepo(): FirestoreProcessRepository {
    const fakeDb = {} as import('firebase/firestore').Firestore;
    return new FirestoreProcessRepository(fakeDb);
  }

  it('[ERROR] saving a config that already exists throws ConfigVersionAlreadyExistsError', async () => {
    const repo = createFirestoreRepo();
    mockGetDoc.mockResolvedValue({ exists: () => true, data: () => ({}) });

    await expect(
      repo.saveProcessConfig(createTestConfig()),
    ).rejects.toThrow(ConfigVersionAlreadyExistsError);
  });

  it('[DATA] saving a new config version succeeds', async () => {
    const repo = createFirestoreRepo();
    mockGetDoc.mockResolvedValue({ exists: () => false });

    await expect(
      repo.saveProcessConfig(createTestConfig()),
    ).resolves.toBeUndefined();

    expect(mockSetDoc).toHaveBeenCalledOnce();
  });

  it('[DATA] getProcessConfig retrieves with 3-part composite key', async () => {
    const repo = createFirestoreRepo();
    const configData = createTestConfig();
    mockGetDoc.mockResolvedValue({ exists: () => true, data: () => configData });

    const result = await repo.getProcessConfig('supply-chain-review', 'default', '1.0.0');
    expect(result).toEqual(configData);

    // Verify doc was called with the 3-part key
    expect(mockDoc).toHaveBeenCalledWith(
      expect.anything(),
      'processConfigs',
      'supply-chain-review:default:1.0.0',
    );
  });

  it('[ERROR] ConfigVersionAlreadyExistsError has correct error message format', () => {
    const error = new ConfigVersionAlreadyExistsError('my-process', 'staging', '2.0');
    expect(error.message).toContain('my-process');
    expect(error.message).toContain('staging');
    expect(error.message).toContain('2.0');
    expect(error.name).toBe('ConfigVersionAlreadyExistsError');
    expect(error).toBeInstanceOf(Error);
  });
});
