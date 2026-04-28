import { describe, it, expect, beforeEach, vi } from 'vitest';
import { InMemoryProcessRepository } from '@mediforce/platform-core';
import type {
  ProcessDefinition,
  ProcessConfig,
  WorkflowDefinition,
} from '@mediforce/platform-core';
import { buildWorkflowDefinition } from '@mediforce/platform-core/testing';
import {
  FirestoreProcessRepository,
  ConfigVersionAlreadyExistsError,
  WorkflowDefinitionVersionAlreadyExistsError,
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
      expect(repo.count()).toMatchObject({ definitions: 0, configs: 0 });

      await repo.saveProcessDefinition(createTestDefinition());
      await repo.saveProcessConfig(createTestConfig());

      expect(repo.count()).toMatchObject({ definitions: 1, configs: 1 });
    });

    it('clear removes all stored data', async () => {
      await repo.saveProcessDefinition(createTestDefinition());
      await repo.saveProcessConfig(createTestConfig());

      repo.clear();
      expect(repo.count()).toMatchObject({ definitions: 0, configs: 0 });
    });
  });
});

// Admin SDK is method-chained on the Firestore instance.
// We build a fakeDb whose methods return a shared chainable stub —
// any call returns `chain` so `.collection().doc().get()` works,
// and terminal calls (get/set/update/add) are controllable spies.
const {
  mockGet, mockSet, mockUpdate, mockAdd,
  mockDoc, mockCollection, mockCollectionGroup,
  mockWhere, mockOrderBy, mockLimit,
} = vi.hoisted(() => ({
  mockGet: vi.fn(),
  mockSet: vi.fn(),
  mockUpdate: vi.fn(),
  mockAdd: vi.fn(),
  mockDoc: vi.fn(),
  mockCollection: vi.fn(),
  mockCollectionGroup: vi.fn(),
  mockWhere: vi.fn(),
  mockOrderBy: vi.fn(),
  mockLimit: vi.fn(),
}));

function buildChain() {
  return {
    doc: mockDoc,
    collection: mockCollection,
    where: mockWhere,
    orderBy: mockOrderBy,
    limit: mockLimit,
    get: mockGet,
    set: mockSet,
    update: mockUpdate,
    add: mockAdd,
  };
}

function resetChainMocks() {
  vi.resetAllMocks();
  const chain = buildChain();
  mockCollection.mockReturnValue(chain);
  mockCollectionGroup.mockReturnValue(chain);
  mockDoc.mockReturnValue(chain);
  mockWhere.mockReturnValue(chain);
  mockOrderBy.mockReturnValue(chain);
  mockLimit.mockReturnValue(chain);
  mockSet.mockResolvedValue(undefined);
  mockUpdate.mockResolvedValue(undefined);
}

function makeFakeDb() {
  return {
    collection: mockCollection,
    collectionGroup: mockCollectionGroup,
  } as unknown as import('firebase-admin/firestore').Firestore;
}

describe('FirestoreProcessRepository - config immutability', () => {
  beforeEach(() => {
    resetChainMocks();
  });

  function createFirestoreRepo(): FirestoreProcessRepository {
    return new FirestoreProcessRepository(makeFakeDb());
  }

  it('[ERROR] saving a config that already exists throws ConfigVersionAlreadyExistsError', async () => {
    const repo = createFirestoreRepo();
    mockGet.mockResolvedValue({ exists: true, data: () => ({}) });

    await expect(
      repo.saveProcessConfig(createTestConfig()),
    ).rejects.toThrow(ConfigVersionAlreadyExistsError);
  });

  it('[DATA] saving a new config version succeeds', async () => {
    const repo = createFirestoreRepo();
    mockGet.mockResolvedValue({ exists: false });

    await expect(
      repo.saveProcessConfig(createTestConfig()),
    ).resolves.toBeUndefined();

    expect(mockSet).toHaveBeenCalledOnce();
  });

  it('[DATA] getProcessConfig retrieves with 3-part composite key', async () => {
    const repo = createFirestoreRepo();
    const configData = createTestConfig();
    mockGet.mockResolvedValue({ exists: true, data: () => configData });

    const result = await repo.getProcessConfig('supply-chain-review', 'default', '1.0.0');
    expect(result).toEqual(configData);

    expect(mockCollection).toHaveBeenCalledWith('processConfigs');
    expect(mockDoc).toHaveBeenCalledWith('supply-chain-review:default:1.0.0');
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

describe('FirestoreProcessRepository - WorkflowDefinition', () => {
  beforeEach(() => {
    resetChainMocks();
  });

  function createFirestoreRepo(): FirestoreProcessRepository {
    return new FirestoreProcessRepository(makeFakeDb());
  }

  it('[DATA] saveWorkflowDefinition + getWorkflowDefinition round-trip works', async () => {
    const repo = createFirestoreRepo();
    const definition = buildWorkflowDefinition({ name: 'drug-approval', version: 1 });

    mockGet
      .mockResolvedValueOnce({ exists: false }) // saveWorkflowDefinition existence check
      .mockResolvedValueOnce({ exists: true, data: () => definition }); // getWorkflowDefinition fetch

    await repo.saveWorkflowDefinition(definition);
    const result = await repo.getWorkflowDefinition('drug-approval', 1);

    expect(result).toEqual(definition);
    expect(mockSet).toHaveBeenCalledOnce();
    expect(mockCollection).toHaveBeenCalledWith('workflowDefinitions');
    expect(mockDoc).toHaveBeenCalledWith('drug-approval:1');
  });

  it('[DATA] getWorkflowDefinition returns null for non-existent', async () => {
    const repo = createFirestoreRepo();
    mockGet.mockResolvedValue({ exists: false, docs: [] });

    const result = await repo.getWorkflowDefinition('nonexistent', 1);
    expect(result).toBeNull();
  });

  it('[ERROR] saveWorkflowDefinition throws WorkflowDefinitionVersionAlreadyExistsError when version exists', async () => {
    const repo = createFirestoreRepo();
    mockGet.mockResolvedValue({ exists: true, data: () => ({}) });

    const definition = buildWorkflowDefinition({ name: 'drug-approval', version: 1 });

    await expect(
      repo.saveWorkflowDefinition(definition),
    ).rejects.toThrow(WorkflowDefinitionVersionAlreadyExistsError);
  });

  it('[ERROR] WorkflowDefinitionVersionAlreadyExistsError has correct message and name', () => {
    const error = new WorkflowDefinitionVersionAlreadyExistsError('drug-approval', 3);
    expect(error.message).toContain('drug-approval');
    expect(error.message).toContain('3');
    expect(error.name).toBe('WorkflowDefinitionVersionAlreadyExistsError');
    expect(error).toBeInstanceOf(Error);
  });

  it('[DATA] listWorkflowDefinitions groups by name and finds latest version', async () => {
    const repo = createFirestoreRepo();
    const defV1 = buildWorkflowDefinition({ name: 'drug-approval', version: 1 });
    const defV2 = buildWorkflowDefinition({ name: 'drug-approval', version: 2 });
    const defOther = buildWorkflowDefinition({ name: 'supply-check', version: 1 });

    mockGet.mockResolvedValue({
      exists: false,
      docs: [
        { id: 'drug-approval:1', data: () => defV1 },
        { id: 'drug-approval:2', data: () => defV2 },
        { id: 'supply-check:1', data: () => defOther },
      ],
    });

    const result = await repo.listWorkflowDefinitions();

    expect(result.definitions).toHaveLength(2);

    const drugApprovalGroup = result.definitions.find((d) => d.name === 'drug-approval');
    expect(drugApprovalGroup).toBeDefined();
    expect(drugApprovalGroup?.versions).toHaveLength(2);
    expect(drugApprovalGroup?.latestVersion).toBe(2);

    const supplyCheckGroup = result.definitions.find((d) => d.name === 'supply-check');
    expect(supplyCheckGroup).toBeDefined();
    expect(supplyCheckGroup?.versions).toHaveLength(1);
    expect(supplyCheckGroup?.latestVersion).toBe(1);
  });

  it('[DATA] listWorkflowDefinitions returns empty when no documents', async () => {
    const repo = createFirestoreRepo();
    mockGet.mockResolvedValue({ exists: false, docs: [] });

    const result = await repo.listWorkflowDefinitions();
    expect(result.definitions).toHaveLength(0);
  });

  it('[DATA] getLatestWorkflowVersion returns max version for name', async () => {
    const repo = createFirestoreRepo();
    const defV1 = buildWorkflowDefinition({ name: 'drug-approval', version: 1 });
    const defV3 = buildWorkflowDefinition({ name: 'drug-approval', version: 3 });

    mockGet.mockResolvedValue({
      empty: false,
      docs: [
        { id: 'drug-approval:1', data: () => defV1 },
        { id: 'drug-approval:3', data: () => defV3 },
      ],
    });

    const version = await repo.getLatestWorkflowVersion('drug-approval');
    expect(version).toBe(3);
  });

  it('[DATA] getLatestWorkflowVersion returns 0 when no definitions exist', async () => {
    const repo = createFirestoreRepo();
    mockGet.mockResolvedValue({ docs: [], empty: true });

    const version = await repo.getLatestWorkflowVersion('nonexistent');
    expect(version).toBe(0);
  });

  it('[DATA] saveWorkflowDefinition uses {name}:{version} document key', async () => {
    const repo = createFirestoreRepo();
    mockGet.mockResolvedValue({ exists: false });

    const definition = buildWorkflowDefinition({ name: 'my-workflow', version: 42 });
    await repo.saveWorkflowDefinition(definition);

    expect(mockCollection).toHaveBeenCalledWith('workflowDefinitions');
    expect(mockDoc).toHaveBeenCalledWith('my-workflow:42');
  });

  // Legacy processDefinitions fallback tests
  it('[DATA] getWorkflowDefinition falls back to legacy processDefinitions when primary not found', async () => {
    const repo = createFirestoreRepo();
    const definition = buildWorkflowDefinition({ name: 'legacy-workflow', version: 1 });

    // Primary workflowDefinitions: not found (exists=false); legacy processDefinitions: one matching doc
    mockGet
      .mockResolvedValueOnce({ exists: false })
      .mockResolvedValueOnce({
        docs: [
          { id: 'legacy-doc', data: () => ({ ...definition, version: '1' }) },
        ],
      });

    const result = await repo.getWorkflowDefinition('legacy-workflow', 1);
    expect(result).not.toBeNull();
    expect(result?.name).toBe('legacy-workflow');
    expect(result?.version).toBe(1);
  });

  it('[DATA] getWorkflowDefinition skips legacy doc that fails schema parse and returns null', async () => {
    const repo = createFirestoreRepo();

    mockGet
      .mockResolvedValueOnce({ exists: false })
      .mockResolvedValueOnce({
        docs: [
          { id: 'bad-doc', data: () => ({ name: 'bad-workflow', version: '1' }) },
        ],
      });

    const result = await repo.getWorkflowDefinition('bad-workflow', 1);
    expect(result).toBeNull();
  });

  it('[DATA] getWorkflowDefinition selects correct legacy doc when multiple exist', async () => {
    const repo = createFirestoreRepo();
    const defV1 = buildWorkflowDefinition({ name: 'multi-legacy', version: 1 });
    const defV2 = buildWorkflowDefinition({ name: 'multi-legacy', version: 2 });

    mockGet
      .mockResolvedValueOnce({ exists: false })
      .mockResolvedValueOnce({
        docs: [
          { id: 'doc-v1', data: () => ({ ...defV1, version: '1' }) },
          { id: 'doc-v2', data: () => ({ ...defV2, version: '2' }) },
        ],
      });

    const result = await repo.getWorkflowDefinition('multi-legacy', 2);
    expect(result).not.toBeNull();
    expect(result?.version).toBe(2);
  });
});
