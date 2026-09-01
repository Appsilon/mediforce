import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  InMemoryProcessRepository,
  buildWorkflowDefinition,
  resetFactorySequence,
} from '@mediforce/platform-core/testing';
import { createTestScope, userCaller } from '../../../repositories/__tests__/create-test-scope';
import { stubUserDirectory } from '../../../testing/stub-user-directory';
import {
  assertCallerMayEditWorkflow,
  assertCallerMayRunWorkflow,
  resolveCallerWorkflowVerbs,
} from '../_access-gate';

/**
 * The shared predicate behind both workflow verbs (ADR-0019, #1253). The
 * handlers that call it are covered in `workflow-access.test.ts`; this file
 * covers the properties they all inherit and none of them re-tests.
 */
const NAMESPACE = 'team-alpha';
const WORKFLOW = 'gated-flow';

describe('_access-gate', () => {
  let processRepo: InMemoryProcessRepository;

  beforeEach(async () => {
    resetFactorySequence();
    processRepo = new InMemoryProcessRepository();
    await processRepo.saveWorkflowDefinition(
      buildWorkflowDefinition({ name: WORKFLOW, version: 1, namespace: NAMESPACE }),
    );
  });

  function scopeFor(processRoles: readonly string[] = []) {
    return createTestScope({
      processRepo,
      caller: userCaller(
        'user-42',
        [NAMESPACE],
        undefined,
        new Map([[NAMESPACE, new Set(processRoles)]]),
      ),
      userDirectory: stubUserDirectory(),
    });
  }

  it('reads the run list for run and the edit list for edit, never the other', async () => {
    await processRepo.setWorkflowAccess(NAMESPACE, WORKFLOW, {
      run: ['runner'],
      edit: ['editor'],
    });
    const scope = scopeFor(['runner']);

    await expect(assertCallerMayRunWorkflow(scope, NAMESPACE, WORKFLOW)).resolves.toBeUndefined();
    await expect(assertCallerMayEditWorkflow(scope, NAMESPACE, WORKFLOW)).rejects.toMatchObject({
      code: 'forbidden',
    });
  });

  it('names the verb in the refusal, so a denied Start does not read as a denied step', async () => {
    await processRepo.setWorkflowAccess(NAMESPACE, WORKFLOW, { run: ['runner'], edit: [] });
    // Somebody holds the role, so the refusal is about this caller rather than
    // the zero-holder case the message otherwise reports.
    const scope = createTestScope({
      processRepo,
      caller: userCaller('user-42', [NAMESPACE]),
      userDirectory: stubUserDirectory({
        async getUsersByRoleInNamespace() {
          return [{ uid: 'someone-else', email: 'someone@example.com' }];
        },
      }),
    });

    await expect(assertCallerMayRunWorkflow(scope, NAMESPACE, WORKFLOW)).rejects.toThrow(
      /Starting a run of this workflow requires 'runner'/,
    );
  });

  it('names the missing grant when the gate lists a role nobody holds', async () => {
    await processRepo.setWorkflowAccess(NAMESPACE, WORKFLOW, { run: [], edit: ['ghost'] });

    await expect(assertCallerMayEditWorkflow(scopeFor(), NAMESPACE, WORKFLOW)).rejects.toThrow(
      /No one in this workspace holds 'ghost'/,
    );
  });

  it('spends no read on a system actor — the cron heartbeat crosses this path every tick', async () => {
    await processRepo.setWorkflowAccess(NAMESPACE, WORKFLOW, { run: ['runner'], edit: [] });
    const scope = createTestScope({ processRepo });
    const getAccess = vi.spyOn(scope.workflowDefinitions, 'getAccess');

    await expect(assertCallerMayRunWorkflow(scope, NAMESPACE, WORKFLOW)).resolves.toBeUndefined();
    expect(getAccess).not.toHaveBeenCalled();
  });

  it('refuses to answer for a caller who cannot see the workspace, rather than answering "open"', async () => {
    const outsider = createTestScope({
      processRepo,
      caller: userCaller('user-99', ['other-team']),
      userDirectory: stubUserDirectory(),
    });

    await expect(
      assertCallerMayRunWorkflow(outsider, NAMESPACE, WORKFLOW),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('answers both verbs at once for the client that has to decide what to offer', async () => {
    const scope = scopeFor(['runner']);

    expect(
      await resolveCallerWorkflowVerbs(scope.caller, scope.system.userDirectory, NAMESPACE, WORKFLOW, {
        run: ['runner'],
        edit: ['editor'],
      }),
    ).toEqual({ mayRun: true, mayEdit: false });

    // And the unconfigured workflow is open on both, which is what makes the
    // Start button stay enabled everywhere nobody has set a gate.
    expect(
      await resolveCallerWorkflowVerbs(
        scope.caller,
        scope.system.userDirectory,
        NAMESPACE,
        WORKFLOW,
        { run: [], edit: [] },
      ),
    ).toEqual({ mayRun: true, mayEdit: true });
  });
});
