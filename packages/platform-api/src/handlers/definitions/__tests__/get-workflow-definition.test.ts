import { describe, expect, it, beforeEach } from 'vitest';
import {
  InMemoryProcessRepository,
  buildWorkflowDefinition,
} from '@mediforce/platform-core/testing';
import { getWorkflowDefinition } from '../get-workflow-definition.js';
import { NotFoundError } from '../../../errors.js';
import type { CallerIdentity } from '../../../auth.js';

const apiKey: CallerIdentity = { kind: 'apiKey' };

describe('getWorkflowDefinition handler', () => {
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

    const result = await getWorkflowDefinition(
      { name: 'flow-a' },
      { processRepo },
      apiKey,
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

    const result = await getWorkflowDefinition(
      { name: 'flow-a', version: 1 },
      { processRepo },
      apiKey,
    );

    expect(result.definition.version).toBe(1);
  });

  it('throws NotFoundError when the name is unknown', async () => {
    await expect(
      getWorkflowDefinition({ name: 'missing' }, { processRepo }, apiKey),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('throws NotFoundError when the explicit version does not exist', async () => {
    await processRepo.saveWorkflowDefinition(
      buildWorkflowDefinition({ name: 'flow-a', version: 1, namespace: '' }),
    );

    await expect(
      getWorkflowDefinition({ name: 'flow-a', version: 99 }, { processRepo }, apiKey),
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

    await expect(
      getWorkflowDefinition(
        { name: 'flow-a', namespace: 'team-beta' },
        { processRepo },
        apiKey,
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

    const result = await getWorkflowDefinition(
      { name: 'flow-a', namespace: 'team-alpha' },
      { processRepo },
      apiKey,
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

    const stranger: CallerIdentity = {
      kind: 'user',
      uid: 'u-1',
      namespaces: new Set(['team-other']),
    };

    const result = await getWorkflowDefinition(
      { name: 'flow-public', namespace: 'team-alpha' },
      { processRepo },
      stranger,
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

    const member: CallerIdentity = {
      kind: 'user',
      uid: 'u-1',
      namespaces: new Set(['team-alpha']),
    };

    const result = await getWorkflowDefinition(
      { name: 'flow-private', namespace: 'team-alpha' },
      { processRepo },
      member,
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

    const stranger: CallerIdentity = {
      kind: 'user',
      uid: 'u-2',
      namespaces: new Set(['team-beta']),
    };

    await expect(
      getWorkflowDefinition(
        { name: 'flow-private', namespace: 'team-alpha' },
        { processRepo },
        stranger,
      ),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});
