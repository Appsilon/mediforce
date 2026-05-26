import { describe, expect, it, beforeEach } from 'vitest';
import {
  InMemoryProcessRepository,
  buildWorkflowDefinition,
} from '@mediforce/platform-core/testing';
import { listWorkflows } from '../list-workflows.js';
import { createTestScope, userCaller } from '../../../repositories/__tests__/create-test-scope.js';

describe('listWorkflows handler', () => {
  let processRepo: InMemoryProcessRepository;

  beforeEach(() => {
    processRepo = new InMemoryProcessRepository();
  });

  it('returns { definitions: [] } when nothing is registered', async () => {
    const scope = createTestScope({ processRepo });
    const result = await listWorkflows({}, scope);
    expect(result.definitions).toEqual([]);
  });

  it('groups versions by name and resolves the latest version', async () => {
    await processRepo.saveWorkflowDefinition(
      buildWorkflowDefinition({ name: 'flow-a', version: 1 }),
    );
    await processRepo.saveWorkflowDefinition(
      buildWorkflowDefinition({ name: 'flow-a', version: 2 }),
    );
    await processRepo.saveWorkflowDefinition(
      buildWorkflowDefinition({ name: 'flow-b', version: 1 }),
    );

    const scope = createTestScope({ processRepo });
    const result = await listWorkflows({}, scope);

    expect(result.definitions).toHaveLength(2);
    const flowA = result.definitions.find((d) => d.name === 'flow-a');
    expect(flowA?.latestVersion).toBe(2);
    expect(flowA?.definition?.version).toBe(2);
  });

  it('returns latest version per name (newest version wins)', async () => {
    await processRepo.saveWorkflowDefinition(
      buildWorkflowDefinition({ name: 'flow-a', version: 1 }),
    );
    await processRepo.saveWorkflowDefinition(
      buildWorkflowDefinition({ name: 'flow-a', version: 3 }),
    );
    await processRepo.saveWorkflowDefinition(
      buildWorkflowDefinition({ name: 'flow-a', version: 2 }),
    );

    const scope = createTestScope({ processRepo });
    const result = await listWorkflows({}, scope);

    expect(result.definitions).toHaveLength(1);
    expect(result.definitions[0]?.latestVersion).toBe(3);
    expect(result.definitions[0]?.definition?.version).toBe(3);
  });

  describe('visibility + namespace filtering for user callers', () => {
    beforeEach(async () => {
      await processRepo.saveWorkflowDefinition(
        buildWorkflowDefinition({
          name: 'alpha-private',
          version: 1,
          namespace: 'team-alpha',
          visibility: 'private',
        }),
      );
      await processRepo.saveWorkflowDefinition(
        buildWorkflowDefinition({
          name: 'beta-private',
          version: 1,
          namespace: 'team-beta',
          visibility: 'private',
        }),
      );
      await processRepo.saveWorkflowDefinition(
        buildWorkflowDefinition({
          name: 'beta-public',
          version: 1,
          namespace: 'team-beta',
          visibility: 'public',
        }),
      );
    });

    it('api-key callers see every group regardless of visibility', async () => {
      const scope = createTestScope({ processRepo });
      const result = await listWorkflows({}, scope);
      expect(result.definitions.map((d) => d.name).sort()).toEqual([
        'alpha-private',
        'beta-private',
        'beta-public',
      ]);
    });

    it('user callers see public + their-namespace workflows', async () => {
      const scope = createTestScope({
        processRepo,
        caller: userCaller('u-1', ['team-alpha']),
      });

      const result = await listWorkflows({}, scope);

      expect(result.definitions.map((d) => d.name).sort()).toEqual([
        'alpha-private',
        'beta-public',
      ]);
    });

    it('user callers without namespace overlap only see public workflows', async () => {
      const scope = createTestScope({
        processRepo,
        caller: userCaller('u-2', ['team-gamma']),
      });

      const result = await listWorkflows({}, scope);

      expect(result.definitions.map((d) => d.name)).toEqual(['beta-public']);
    });

    it('respects the optional namespace filter while honouring visibility', async () => {
      const scope = createTestScope({
        processRepo,
        caller: userCaller('u-1', ['team-alpha']),
      });

      const result = await listWorkflows(
        { namespace: 'team-beta' },
        scope,
      );

      // team-alpha user can see team-beta's public workflow, scoped via filter.
      expect(result.definitions.map((d) => d.name)).toEqual(['beta-public']);
    });

    it('namespace filter applies for api-key callers too', async () => {
      const scope = createTestScope({ processRepo });
      const result = await listWorkflows(
        { namespace: 'team-alpha' },
        scope,
      );

      expect(result.definitions.map((d) => d.name)).toEqual(['alpha-private']);
    });
  });
});
