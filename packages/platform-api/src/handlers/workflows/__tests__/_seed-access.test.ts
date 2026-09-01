import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DEFAULT_WORKFLOW_ACCESS } from '@mediforce/platform-core';
import {
  InMemoryUserDirectoryService,
  InMemoryAuditRepository,
  InMemoryProcessInstanceRepository,
  InMemoryProcessRepository,
  InMemoryTriggerRepository,
  buildWorkflowDefinition,
  resetFactorySequence,
} from '@mediforce/platform-core/testing';
import { registerWorkflow } from '../register-workflow';
import { createTestScope, userCaller } from '../../../repositories/__tests__/create-test-scope';

vi.mock('../../system/_docker', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../system/_docker')>();
  return {
    ...actual,
    isLocalAgentMode: vi.fn().mockReturnValue(false),
    fetchFromContainerWorker: vi.fn().mockResolvedValue({ available: false }),
    fetchFromLocalDocker: vi.fn().mockResolvedValue({ available: false }),
  };
});

/**
 * The default access a workflow's first version is registered with, and the
 * grant that keeps it from being a lockout (ADR-0020).
 *
 * Driven through `registerWorkflow` rather than by calling the seeder, because
 * every rule here is about *when* it runs — v1 only, user callers only — and a
 * direct call would assert the seeder's body while leaving the condition that
 * guards it untested.
 */
const NAMESPACE = 'team-alpha';

describe('default workflow access (ADR-0020)', () => {
  let processRepo: InMemoryProcessRepository;
  let auditRepo: InMemoryAuditRepository;
  let triggerRepo: InMemoryTriggerRepository;
  let directory: InMemoryUserDirectoryService;

  beforeEach(() => {
    resetFactorySequence();
    processRepo = new InMemoryProcessRepository();
    auditRepo = new InMemoryAuditRepository(new InMemoryProcessInstanceRepository());
    triggerRepo = new InMemoryTriggerRepository();
    directory = new InMemoryUserDirectoryService();
    directory.addUser({ uid: 'user-42', email: 'author@example.com' });
    directory.addMember('user-42', NAMESPACE);
  });

  function buildScope(options: { systemActor?: boolean; noDirectory?: boolean } = {}) {
    return createTestScope({
      processRepo,
      auditRepo,
      triggerRepo,
      userDirectory: options.noDirectory === true ? null : directory,
      ...(options.systemActor === true ? {} : { caller: userCaller('user-42', [NAMESPACE]) }),
    });
  }

  async function register(name: string, scope = buildScope()): Promise<void> {
    const body = buildWorkflowDefinition({ name, namespace: NAMESPACE });
    body.steps[1].agent = { image: 'test-image' };
    const { version: _version, createdAt: _createdAt, namespace: _namespace, ...input } = body;
    await registerWorkflow({ ...input, namespace: NAMESPACE }, scope);
  }

  it('seeds the built-in role lists on the first version', async () => {
    await register('flow-one');

    expect(await processRepo.getWorkflowAccess(NAMESPACE, 'flow-one')).toEqual(
      DEFAULT_WORKFLOW_ACCESS,
    );
  });

  it('makes the author a workflow-manager on the workflow they created, and only on it', async () => {
    await register('flow-mine');

    // Narrowed, not workspace-wide: creating one workflow says nothing about
    // the next one, which may be somebody else's.
    expect(await directory.getGrantsForUser('user-42', NAMESPACE)).toEqual([
      { role: 'workflow-manager', workflowName: 'flow-mine' },
    ]);
    expect(await directory.getRolesForUser('user-42', NAMESPACE, 'flow-mine')).toEqual([
      'workflow-manager',
    ]);
    expect(await directory.getRolesForUser('user-42', NAMESPACE, 'other-flow')).toEqual([]);
  });

  it('lets the author still save a second version through the edit gate it just seeded', async () => {
    const scope = buildScope();
    await register('flow-twice', scope);

    // The regression the creator grant exists to prevent: seeding `edit` with
    // roles the author does not hold would refuse them their own next Save.
    await expect(register('flow-twice', scope)).resolves.toBeUndefined();
    expect(await processRepo.getLatestWorkflowVersion(NAMESPACE, 'flow-twice')).toBe(2);
  });

  it('leaves the lists alone on later versions', async () => {
    const scope = buildScope();
    await register('flow-edited', scope);
    await processRepo.setWorkflowAccess(NAMESPACE, 'flow-edited', {
      run: [],
      edit: ['workflow-manager'],
    });

    await register('flow-edited', scope);

    // An admin who opened `run` to every member must not have it re-gated by
    // the next Save — and an empty list is a decision, not an unconfigured row.
    expect(await processRepo.getWorkflowAccess(NAMESPACE, 'flow-edited')).toEqual({
      run: [],
      edit: ['workflow-manager'],
    });
  });

  it('leaves a workflow registered by automation open', async () => {
    await register('flow-seeded', buildScope({ systemActor: true }));

    // A system actor has no uid to grant, so a seeded gate here would name
    // roles nobody in the workspace holds. The CLI, imports and seeds keep
    // producing workflows every member can run (AGENTS.md §13).
    expect(await processRepo.getWorkflowAccess(NAMESPACE, 'flow-seeded')).toEqual({
      run: [],
      edit: [],
    });
  });

  it('leaves the workflow open when the deployment wires no user directory', async () => {
    await register('flow-directoryless', buildScope({ noDirectory: true }));

    expect(await processRepo.getWorkflowAccess(NAMESPACE, 'flow-directoryless')).toEqual({
      run: [],
      edit: [],
    });
  });

  it('leaves the workflow open rather than half-gated when the grant fails', async () => {
    // Not a member of the workspace as far as the directory is concerned —
    // the gate must not land without the grant that licenses it.
    const scope = createTestScope({
      processRepo,
      auditRepo,
      triggerRepo,
      userDirectory: directory,
      caller: userCaller('stranger', [NAMESPACE]),
    });

    await register('flow-ungrantable', scope);

    expect(await processRepo.getWorkflowAccess(NAMESPACE, 'flow-ungrantable')).toEqual({
      run: [],
      edit: [],
    });
  });

  it('records the seeded access in the audit trail', async () => {
    await register('flow-audited');

    const seeded = auditRepo.getAll().find((event) => event.action === 'workflow.access_changed');
    expect(seeded?.description).toContain('seeded with the default access');
    expect(seeded?.outputSnapshot).toMatchObject({
      grantedToCreator: 'workflow-manager@flow-audited',
    });
  });
});
