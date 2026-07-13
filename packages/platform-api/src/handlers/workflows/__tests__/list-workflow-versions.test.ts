import { describe, expect, it, beforeEach } from 'vitest';
import {
  InMemoryProcessRepository,
  buildWorkflowDefinition,
} from '@mediforce/platform-core/testing';
import { listWorkflowVersions } from '../list-workflow-versions';
import { NotFoundError } from '../../../errors';
import { createTestScope, userCaller } from '../../../repositories/__tests__/create-test-scope';

describe('listWorkflowVersions handler', () => {
  let processRepo: InMemoryProcessRepository;

  beforeEach(() => {
    processRepo = new InMemoryProcessRepository();
  });

  it('returns metadata for every version, with null defaultVersion when no pin', async () => {
    await processRepo.saveWorkflowDefinition(
      buildWorkflowDefinition({ name: 'flow-a', namespace: 'team-alpha', version: 1 }),
    );
    await processRepo.saveWorkflowDefinition(
      buildWorkflowDefinition({ name: 'flow-a', namespace: 'team-alpha', version: 2 }),
    );

    const scope = createTestScope({
      processRepo,
      caller: userCaller('u-1', ['team-alpha']),
    });

    const result = await listWorkflowVersions(
      { name: 'flow-a', namespace: 'team-alpha' },
      scope,
    );

    expect(result.versions.map((v) => v.version).sort()).toEqual([1, 2]);
    expect(result.defaultVersion).toBeNull();

    // Critical: output is metadata-only. The whole point of this endpoint
    // is to avoid eager-loading every version's full body.
    for (const version of result.versions) {
      expect(version).not.toHaveProperty('steps');
      expect(version).not.toHaveProperty('triggers');
      expect(version).not.toHaveProperty('transitions');
    }
  });

  it('echoes the pinned default version', async () => {
    await processRepo.saveWorkflowDefinition(
      buildWorkflowDefinition({ name: 'flow-a', namespace: 'team-alpha', version: 1 }),
    );
    await processRepo.saveWorkflowDefinition(
      buildWorkflowDefinition({ name: 'flow-a', namespace: 'team-alpha', version: 2 }),
    );
    await processRepo.setDefaultWorkflowVersion('team-alpha', 'flow-a', 1);

    const scope = createTestScope({
      processRepo,
      caller: userCaller('u-1', ['team-alpha']),
    });

    const result = await listWorkflowVersions(
      { name: 'flow-a', namespace: 'team-alpha' },
      scope,
    );

    expect(result.defaultVersion).toBe(1);
  });

  it('preserves the archived flag per version and counts steps / triggers', async () => {
    await processRepo.saveWorkflowDefinition(
      buildWorkflowDefinition({
        name: 'flow-a',
        namespace: 'team-alpha',
        version: 1,
        archived: true,
        title: 'My Flow',
        description: 'first version',
      }),
    );
    await processRepo.saveWorkflowDefinition(
      buildWorkflowDefinition({ name: 'flow-a', namespace: 'team-alpha', version: 2 }),
    );

    const scope = createTestScope({
      processRepo,
      caller: userCaller('u-1', ['team-alpha']),
    });

    const result = await listWorkflowVersions(
      { name: 'flow-a', namespace: 'team-alpha' },
      scope,
    );

    const v1 = result.versions.find((v) => v.version === 1);
    const v2 = result.versions.find((v) => v.version === 2);

    expect(v1).toEqual(
      expect.objectContaining({
        version: 1,
        archived: true,
        title: 'My Flow',
        description: 'first version',
        // buildWorkflowDefinition seeds 3 steps + 1 trigger.
        stepCount: 3,
        triggerCount: 1,
      }),
    );
    expect(v2?.archived).toBe(false);
  });

  it('throws NotFoundError when no versions exist', async () => {
    const scope = createTestScope({
      processRepo,
      caller: userCaller('u-1', ['team-alpha']),
    });
    await expect(
      listWorkflowVersions({ name: 'missing', namespace: 'team-alpha' }, scope),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('throws NotFoundError when caller cannot see a private workflow in another namespace', async () => {
    await processRepo.saveWorkflowDefinition(
      buildWorkflowDefinition({
        name: 'flow-private',
        namespace: 'team-alpha',
        version: 1,
        visibility: 'private',
      }),
    );

    const scope = createTestScope({
      processRepo,
      caller: userCaller('u-2', ['team-beta']),
    });

    await expect(
      listWorkflowVersions(
        { name: 'flow-private', namespace: 'team-alpha' },
        scope,
      ),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('returns every version of a public workflow to non-members', async () => {
    await processRepo.saveWorkflowDefinition(
      buildWorkflowDefinition({
        name: 'flow-public',
        namespace: 'team-alpha',
        version: 1,
        visibility: 'public',
      }),
    );
    await processRepo.saveWorkflowDefinition(
      buildWorkflowDefinition({
        name: 'flow-public',
        namespace: 'team-alpha',
        version: 2,
        visibility: 'public',
      }),
    );

    const scope = createTestScope({
      processRepo,
      caller: userCaller('u-2', ['team-beta']),
    });

    const result = await listWorkflowVersions(
      { name: 'flow-public', namespace: 'team-alpha' },
      scope,
    );

    expect(result.versions.map((v) => v.version).sort()).toEqual([1, 2]);
  });
});
