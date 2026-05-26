import { describe, expect, it, beforeEach } from 'vitest';
import {
  InMemoryProcessRepository,
  buildWorkflowDefinition,
} from '@mediforce/platform-core/testing';
import { getWorkflow } from '../get-workflow.js';
import { NotFoundError } from '../../../errors.js';
import { createTestScope, userCaller } from '../../../repositories/__tests__/create-test-scope.js';

describe('getWorkflow handler', () => {
  let processRepo: InMemoryProcessRepository;

  beforeEach(() => {
    processRepo = new InMemoryProcessRepository();
  });

  it('returns the latest version when no version is specified', async () => {
    await processRepo.saveWorkflowDefinition(
      buildWorkflowDefinition({ name: 'flow-a', version: 1, namespace: '' }),
    );
    await processRepo.saveWorkflowDefinition(
      buildWorkflowDefinition({ name: 'flow-a', version: 3, namespace: '' }),
    );
    await processRepo.saveWorkflowDefinition(
      buildWorkflowDefinition({ name: 'flow-a', version: 2, namespace: '' }),
    );

    const scope = createTestScope({ processRepo });
    const result = await getWorkflow(
      { name: 'flow-a' },
      scope,
    );

    expect(result.definition.version).toBe(3);
  });

  it('returns the requested explicit version', async () => {
    await processRepo.saveWorkflowDefinition(
      buildWorkflowDefinition({ name: 'flow-a', version: 1, namespace: '' }),
    );
    await processRepo.saveWorkflowDefinition(
      buildWorkflowDefinition({ name: 'flow-a', version: 2, namespace: '' }),
    );

    const scope = createTestScope({ processRepo });
    const result = await getWorkflow(
      { name: 'flow-a', version: 1 },
      scope,
    );

    expect(result.definition.version).toBe(1);
  });

  it('throws NotFoundError when the name is unknown', async () => {
    const scope = createTestScope({ processRepo });
    await expect(
      getWorkflow({ name: 'missing' }, scope),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('throws NotFoundError when the explicit version does not exist', async () => {
    await processRepo.saveWorkflowDefinition(
      buildWorkflowDefinition({ name: 'flow-a', version: 1, namespace: '' }),
    );

    const scope = createTestScope({ processRepo });
    await expect(
      getWorkflow({ name: 'flow-a', version: 99 }, scope),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('throws NotFoundError when the namespace filter does not match', async () => {
    await processRepo.saveWorkflowDefinition(
      buildWorkflowDefinition({
        name: 'flow-a',
        version: 1,
        namespace: 'team-alpha',
        visibility: 'public',
      }),
    );

    const scope = createTestScope({ processRepo });
    await expect(
      getWorkflow(
        { name: 'flow-a', namespace: 'team-beta' },
        scope,
      ),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('apiKey callers bypass visibility on private workflows', async () => {
    await processRepo.saveWorkflowDefinition(
      buildWorkflowDefinition({
        name: 'flow-a',
        version: 1,
        namespace: 'team-alpha',
        visibility: 'private',
      }),
    );

    const scope = createTestScope({ processRepo });
    const result = await getWorkflow(
      { name: 'flow-a', namespace: 'team-alpha' },
      scope,
    );

    expect(result.definition.name).toBe('flow-a');
  });

  it('public workflows are readable by any user caller', async () => {
    await processRepo.saveWorkflowDefinition(
      buildWorkflowDefinition({
        name: 'flow-public',
        version: 1,
        namespace: 'team-alpha',
        visibility: 'public',
      }),
    );

    const scope = createTestScope({
      processRepo,
      caller: userCaller('u-1', ['team-other']),
    });

    const result = await getWorkflow(
      { name: 'flow-public', namespace: 'team-alpha' },
      scope,
    );

    expect(result.definition.name).toBe('flow-public');
  });

  it('private workflows are readable by namespace members', async () => {
    await processRepo.saveWorkflowDefinition(
      buildWorkflowDefinition({
        name: 'flow-private',
        version: 1,
        namespace: 'team-alpha',
        visibility: 'private',
      }),
    );

    const scope = createTestScope({
      processRepo,
      caller: userCaller('u-1', ['team-alpha']),
    });

    const result = await getWorkflow(
      { name: 'flow-private', namespace: 'team-alpha' },
      scope,
    );

    expect(result.definition.name).toBe('flow-private');
  });

  it('returns NotFoundError (not Forbidden) when a user reads a private workflow outside their namespace', async () => {
    // Anti-enumeration: a forbidden private workflow looks identical on the
    // wire to a missing one. Matches the pre-migration behaviour from
    // `app/api/workflow-definitions/[name]/route.ts`.
    await processRepo.saveWorkflowDefinition(
      buildWorkflowDefinition({
        name: 'flow-private',
        version: 1,
        namespace: 'team-alpha',
        visibility: 'private',
      }),
    );

    const scope = createTestScope({
      processRepo,
      caller: userCaller('u-2', ['team-beta']),
    });

    await expect(
      getWorkflow(
        { name: 'flow-private', namespace: 'team-alpha' },
        scope,
      ),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});
