import { describe, it, expect, beforeEach, vi } from 'vitest';
import { InMemoryProcessRepository } from '@mediforce/platform-core';
import type { WorkflowDefinition } from '@mediforce/platform-core';
import { buildWorkflowDefinition } from '@mediforce/platform-core/testing';
import {
  FirestoreProcessRepository,
  WorkflowDefinitionVersionAlreadyExistsError,
} from '../firestore/process-repository.js';

describe('InMemoryProcessRepository', () => {
  let repo: InMemoryProcessRepository;

  beforeEach(() => {
    repo = new InMemoryProcessRepository();
  });

  describe('WorkflowDefinition', () => {
    it('[DATA] saveWorkflowDefinition + getWorkflowDefinition round-trip works', async () => {
      const definition = buildWorkflowDefinition({ name: 'drug-approval', version: 1 });
      await repo.saveWorkflowDefinition(definition);

      const result = await repo.getWorkflowDefinition('drug-approval', 1);
      expect(result).toEqual(definition);
    });

    it('[DATA] getWorkflowDefinition returns null for non-existent', async () => {
      const result = await repo.getWorkflowDefinition('nonexistent', 1);
      expect(result).toBeNull();
    });

    it('[DATA] stores different versions independently', async () => {
      const v1 = buildWorkflowDefinition({ name: 'drug-approval', version: 1 });
      const v2 = buildWorkflowDefinition({ name: 'drug-approval', version: 2, description: 'Version 2' });

      await repo.saveWorkflowDefinition(v1);
      await repo.saveWorkflowDefinition(v2);

      const resultV1 = await repo.getWorkflowDefinition('drug-approval', 1);
      const resultV2 = await repo.getWorkflowDefinition('drug-approval', 2);

      expect(resultV1?.version).toBe(1);
      expect(resultV2?.version).toBe(2);
      expect(resultV2?.description).toBe('Version 2');
    });

    it('[DATA] getLatestWorkflowVersion returns max version for name', async () => {
      await repo.saveWorkflowDefinition(buildWorkflowDefinition({ name: 'test', version: 1 }));
      await repo.saveWorkflowDefinition(buildWorkflowDefinition({ name: 'test', version: 3 }));

      const version = await repo.getLatestWorkflowVersion('test');
      expect(version).toBe(3);
    });

    it('[DATA] getLatestWorkflowVersion returns 0 when no definitions', async () => {
      const version = await repo.getLatestWorkflowVersion('nonexistent');
      expect(version).toBe(0);
    });

    it('[DATA] listWorkflowDefinitions groups by name', async () => {
      await repo.saveWorkflowDefinition(buildWorkflowDefinition({ name: 'a', version: 1 }));
      await repo.saveWorkflowDefinition(buildWorkflowDefinition({ name: 'a', version: 2 }));
      await repo.saveWorkflowDefinition(buildWorkflowDefinition({ name: 'b', version: 1 }));

      const result = await repo.listWorkflowDefinitions();
      expect(result.definitions).toHaveLength(2);

      const groupA = result.definitions.find((d) => d.name === 'a');
      expect(groupA?.versions).toHaveLength(2);
      expect(groupA?.latestVersion).toBe(2);
    });
  });

  describe('helper methods', () => {
    it('[DATA] count returns correct counts', async () => {
      expect(repo.count()).toMatchObject({ workflowDefinitions: 0 });

      await repo.saveWorkflowDefinition(buildWorkflowDefinition({ name: 'test', version: 1 }));

      expect(repo.count()).toMatchObject({ workflowDefinitions: 1 });
    });

    it('[DATA] clear removes all stored data', async () => {
      await repo.saveWorkflowDefinition(buildWorkflowDefinition({ name: 'test', version: 1 }));

      repo.clear();
      expect(repo.count()).toMatchObject({ workflowDefinitions: 0 });
    });
  });
});

// Admin SDK is method-chained on the Firestore instance.
// We build a fakeDb whose methods return a shared chainable stub --
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
    mockGet.mockResolvedValue({ exists: false });

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

    const result = await repo.listWorkflowDefinitions(false);

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

    const result = await repo.listWorkflowDefinitions(false);
    expect(result.definitions).toHaveLength(0);
  });

  it('[DATA] listWorkflowDefinitions filters archived before parse when includeArchived=false', async () => {
    const repo = createFirestoreRepo();
    const active = buildWorkflowDefinition({ name: 'drug-approval', version: 1 });
    const archived = buildWorkflowDefinition({ name: 'drug-approval', version: 2, archived: true });
    // Legacy doc missing required `namespace` AND archived — must be skipped silently,
    // not surface as a parse warning, since archived WDs are not runnable.
    const archivedLegacy = { ...active, version: 3, archived: true };
    delete (archivedLegacy as { namespace?: string }).namespace;

    mockGet.mockResolvedValue({
      exists: false,
      docs: [
        { id: 'drug-approval:1', data: () => active },
        { id: 'drug-approval:2', data: () => archived },
        { id: 'drug-approval:3', data: () => archivedLegacy },
      ],
    });

    const result = await repo.listWorkflowDefinitions(false);

    expect(result.definitions).toHaveLength(1);
    expect(result.definitions[0].versions).toHaveLength(1);
    expect(result.definitions[0].versions[0].version).toBe(1);
  });

  it('[DATA] listWorkflowDefinitions includes archived when includeArchived=true', async () => {
    const repo = createFirestoreRepo();
    const active = buildWorkflowDefinition({ name: 'drug-approval', version: 1 });
    const archived = buildWorkflowDefinition({ name: 'drug-approval', version: 2, archived: true });

    mockGet.mockResolvedValue({
      exists: false,
      docs: [
        { id: 'drug-approval:1', data: () => active },
        { id: 'drug-approval:2', data: () => archived },
      ],
    });

    const result = await repo.listWorkflowDefinitions(true);

    expect(result.definitions[0].versions).toHaveLength(2);
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
});
