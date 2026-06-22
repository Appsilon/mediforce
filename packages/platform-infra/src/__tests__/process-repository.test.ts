import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryProcessRepository } from '@mediforce/platform-core';
import type { WorkflowDefinition } from '@mediforce/platform-core';
import { buildWorkflowDefinition } from '@mediforce/platform-core/testing';

describe('InMemoryProcessRepository', () => {
  let repo: InMemoryProcessRepository;

  beforeEach(() => {
    repo = new InMemoryProcessRepository();
  });

  describe('WorkflowDefinition', () => {
    it('[DATA] saveWorkflowDefinition + getWorkflowDefinition round-trip works', async () => {
      const definition = buildWorkflowDefinition({ name: 'drug-approval', version: 1 });
      await repo.saveWorkflowDefinition(definition);

      const result = await repo.getWorkflowDefinition('test', 'drug-approval', 1);
      expect(result).toEqual(definition);
    });

    it('[DATA] getWorkflowDefinition returns null for non-existent', async () => {
      const result = await repo.getWorkflowDefinition('test', 'nonexistent', 1);
      expect(result).toBeNull();
    });

    it('[DATA] stores different versions independently', async () => {
      const v1 = buildWorkflowDefinition({ name: 'drug-approval', version: 1 });
      const v2 = buildWorkflowDefinition({ name: 'drug-approval', version: 2, description: 'Version 2' });

      await repo.saveWorkflowDefinition(v1);
      await repo.saveWorkflowDefinition(v2);

      const resultV1 = await repo.getWorkflowDefinition('test', 'drug-approval', 1);
      const resultV2 = await repo.getWorkflowDefinition('test', 'drug-approval', 2);

      expect(resultV1?.version).toBe(1);
      expect(resultV2?.version).toBe(2);
      expect(resultV2?.description).toBe('Version 2');
    });

    it('[DATA] getLatestWorkflowVersion returns max version for name', async () => {
      await repo.saveWorkflowDefinition(buildWorkflowDefinition({ name: 'test', version: 1 }));
      await repo.saveWorkflowDefinition(buildWorkflowDefinition({ name: 'test', version: 3 }));

      const version = await repo.getLatestWorkflowVersion('test', 'test');
      expect(version).toBe(3);
    });

    it('[DATA] isolates latest versions by namespace', async () => {
      await repo.saveWorkflowDefinition(
        buildWorkflowDefinition({
          namespace: 'tenant-a',
          name: 'shared',
          version: 1,
        }),
      );
      await repo.saveWorkflowDefinition(
        buildWorkflowDefinition({
          namespace: 'tenant-b',
          name: 'shared',
          version: 5,
        }),
      );

      await expect(repo.getLatestWorkflowVersion('tenant-a', 'shared')).resolves.toBe(1);
      await expect(repo.getLatestWorkflowVersion('tenant-b', 'shared')).resolves.toBe(5);
    });

    it('[DATA] isolates default versions and list groups by namespace', async () => {
      await repo.saveWorkflowDefinition(
        buildWorkflowDefinition({
          namespace: 'tenant-a',
          name: 'shared',
          version: 1,
        }),
      );
      await repo.saveWorkflowDefinition(
        buildWorkflowDefinition({
          namespace: 'tenant-b',
          name: 'shared',
          version: 5,
        }),
      );
      await repo.setDefaultWorkflowVersion('tenant-a', 'shared', 1);
      await repo.setDefaultWorkflowVersion('tenant-b', 'shared', 5);

      const result = await repo.listAllWorkflowDefinitions(false);

      expect(result.definitions).toHaveLength(2);
      expect(result.definitions).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ namespace: 'tenant-a', name: 'shared', latestVersion: 1, defaultVersion: 1 }),
          expect.objectContaining({ namespace: 'tenant-b', name: 'shared', latestVersion: 5, defaultVersion: 5 }),
        ]),
      );
    });

    it('[DATA] getLatestWorkflowVersion returns 0 when no definitions', async () => {
      const version = await repo.getLatestWorkflowVersion('test', 'nonexistent');
      expect(version).toBe(0);
    });

    it('[DATA] listWorkflowDefinitions groups by name', async () => {
      await repo.saveWorkflowDefinition(buildWorkflowDefinition({ name: 'a', version: 1 }));
      await repo.saveWorkflowDefinition(buildWorkflowDefinition({ name: 'a', version: 2 }));
      await repo.saveWorkflowDefinition(buildWorkflowDefinition({ name: 'b', version: 1 }));

      const result = await repo.listAllWorkflowDefinitions(false);
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
