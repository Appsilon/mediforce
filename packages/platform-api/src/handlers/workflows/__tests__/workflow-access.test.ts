import { describe, it, expect, beforeEach } from 'vitest';
import {
  InMemoryAuditRepository,
  InMemoryProcessInstanceRepository,
  InMemoryProcessRepository,
  buildWorkflowDefinition,
  resetFactorySequence,
} from '@mediforce/platform-core/testing';
import type { CallerScope } from '../../../repositories/index';
import { stubUserDirectory } from '../../../testing/stub-user-directory';
import { createTestScope, userCaller } from '../../../repositories/__tests__/create-test-scope';
import { getWorkflowAccess, setWorkflowAccess } from '../workflow-access';
import { assertCallerMayEditWorkflow, assertCallerMayRunWorkflow } from '../_access-gate';
import { archiveWorkflow, archiveWorkflowVersion } from '../archive-workflow';
import { deleteWorkflow } from '../delete-workflow';
import { setDefaultWorkflowVersion } from '../set-default-version';
import { copyWorkflow } from '../copy-workflow';
import { setWorkflowVisibility } from '../set-visibility';
import { transferWorkflowNamespace } from '../transfer-workflow';

/**
 * The workflow-level `run` / `edit` gates and the tab that administers them
 * (ADR-0019, issue #1253).
 *
 * The invariant every case here circles: **an unconfigured workflow behaves
 * exactly as it did before the gate existed**. That is what makes this
 * deployable without a per-workspace configuration pass (AGENTS.md §13), and
 * it is the one regression a role gate can quietly cause.
 */
const NAMESPACE = 'team-alpha';
const WORKFLOW = 'gated-flow';

describe('workflow access (ADR-0019 #1253)', () => {
  let processRepo: InMemoryProcessRepository;
  let auditRepo: InMemoryAuditRepository;

  beforeEach(async () => {
    resetFactorySequence();
    processRepo = new InMemoryProcessRepository();
    auditRepo = new InMemoryAuditRepository(new InMemoryProcessInstanceRepository());
    await processRepo.saveWorkflowDefinition(
      buildWorkflowDefinition({ name: WORKFLOW, version: 1, namespace: NAMESPACE }),
    );
  });

  /**
   * `processRoles` are the caller's workspace-wide grants; `narrowed` are the
   * ones scoped to a single workflow, which live in the directory rather than
   * on the identity because the gate needs the workflow in hand to honour them.
   */
  function buildScope(options: {
    membership?: 'owner' | 'admin' | 'member';
    processRoles?: readonly string[];
    narrowed?: Readonly<Record<string, readonly string[]>>;
    systemActor?: boolean;
  } = {}): CallerScope {
    const caller = options.systemActor === true
      ? undefined
      : userCaller(
          'user-42',
          [NAMESPACE, 'other-team'],
          new Map([[NAMESPACE, options.membership ?? 'member']]),
          new Map([[NAMESPACE, new Set(options.processRoles ?? [])]]),
        );
    return createTestScope({
      processRepo,
      auditRepo,
      ...(caller === undefined ? {} : { caller }),
      userDirectory: stubUserDirectory({
        async getRolesForUser(_uid, _namespace, workflowName) {
          if (workflowName === undefined) return [...(options.processRoles ?? [])];
          return [...(options.narrowed?.[workflowName] ?? [])];
        },
        async getUsersByRoleInNamespace(role) {
          // Somebody holds every role, so refusals report the caller's own
          // roles rather than the zero-holder message.
          return [{ uid: `holder-of-${role}`, email: `${role}@example.com` }];
        },
      }),
    });
  }

  async function gate(access: { run?: string[]; edit?: string[] }): Promise<void> {
    await processRepo.setWorkflowAccess(NAMESPACE, WORKFLOW, {
      run: access.run ?? [],
      edit: access.edit ?? [],
    });
  }

  describe('getWorkflowAccess', () => {
    it('reports an unconfigured workflow as open to the caller', async () => {
      const result = await getWorkflowAccess({ namespace: NAMESPACE, name: WORKFLOW }, buildScope());

      expect(result.access).toEqual({ run: [], edit: [] });
      expect(result.caller).toEqual({ mayRun: true, mayEdit: true });
    });

    it('answers the caller half with the predicate the gate enforces', async () => {
      await gate({ run: ['reviewer'], edit: ['approver'] });

      const holder = await getWorkflowAccess(
        { namespace: NAMESPACE, name: WORKFLOW },
        buildScope({ processRoles: ['reviewer'] }),
      );
      expect(holder.caller).toEqual({ mayRun: true, mayEdit: false });

      const nobody = await getWorkflowAccess({ namespace: NAMESPACE, name: WORKFLOW }, buildScope());
      expect(nobody.caller).toEqual({ mayRun: false, mayEdit: false });
    });

    it('honours a grant narrowed to this workflow, which the session cannot carry', async () => {
      await gate({ run: ['reviewer'] });

      const result = await getWorkflowAccess(
        { namespace: NAMESPACE, name: WORKFLOW },
        buildScope({ narrowed: { [WORKFLOW]: ['reviewer'] } }),
      );

      expect(result.caller.mayRun).toBe(true);
    });

    it('is readable by a plain member — it is where they learn why Start is disabled', async () => {
      await gate({ run: ['reviewer'] });

      const result = await getWorkflowAccess(
        { namespace: NAMESPACE, name: WORKFLOW },
        buildScope({ membership: 'member' }),
      );

      expect(result.access.run).toEqual(['reviewer']);
    });

    it('404s for a workflow that does not exist', async () => {
      await expect(
        getWorkflowAccess({ namespace: NAMESPACE, name: 'no-such-flow' }, buildScope()),
      ).rejects.toMatchObject({ code: 'not_found' });
    });
  });

  describe('setWorkflowAccess', () => {
    it('writes both lists and audits the change', async () => {
      const result = await setWorkflowAccess(
        {
          namespace: NAMESPACE,
          name: WORKFLOW,
          access: { run: ['reviewer'], edit: ['approver'] },
        },
        buildScope({ membership: 'admin' }),
      );

      // Raised to the built-in floor of ADR-0020: restricting a verb keeps the
      // built-in roles that carry it. The stored value and the returned one are
      // the same, or the tab would render a list the gate does not enforce.
      const stored = { run: ['executor', 'workflow-manager', 'reviewer'], edit: ['editor', 'workflow-manager', 'approver'] };
      expect(result.access).toEqual(stored);
      expect(await processRepo.getWorkflowAccess(NAMESPACE, WORKFLOW)).toEqual(stored);
      const events = auditRepo.getAll();
      expect(events).toHaveLength(1);
      expect(events[0].action).toBe('workflow.access_changed');
      expect(events[0].actorId).toBe('user-42');
      expect(events[0].description).toContain('executor');
    });

    it('a gated workflow still admits the built-in role its list never named', async () => {
      await setWorkflowAccess(
        { namespace: NAMESPACE, name: WORKFLOW, access: { run: ['reviewer'], edit: ['reviewer'] } },
        buildScope({ membership: 'admin' }),
      );

      // The roles-demo case: a workflow gated by hand on `reviewer` alone left
      // the workspace owner unable to run or change the thing they own.
      const manager = buildScope({ membership: 'member', processRoles: ['workflow-manager'] });
      await expect(
        assertCallerMayRunWorkflow(manager, NAMESPACE, WORKFLOW),
      ).resolves.toBeUndefined();
      await expect(
        assertCallerMayEditWorkflow(manager, NAMESPACE, WORKFLOW),
      ).resolves.toBeUndefined();
    });

    it('leaves an unrestricted verb open rather than raising it to the floor', async () => {
      const result = await setWorkflowAccess(
        { namespace: NAMESPACE, name: WORKFLOW, access: { run: [], edit: ['approver'] } },
        buildScope({ membership: 'admin' }),
      );

      // AGENTS.md §12: an empty list is "any member", and a floor applied there
      // would gate every workflow that is open today.
      expect(result.access.run).toEqual([]);
      expect(result.access.edit).toContain('editor');
    });

    it('refuses a plain member, even one who holds edit', async () => {
      await gate({ edit: ['approver'] });

      await expect(
        setWorkflowAccess(
          { namespace: NAMESPACE, name: WORKFLOW, access: { run: ['reviewer'], edit: [] } },
          buildScope({ membership: 'member', processRoles: ['approver'] }),
        ),
      ).rejects.toMatchObject({ code: 'forbidden' });
    });

    it('empty lists clear the gate rather than leaving it alone', async () => {
      await gate({ run: ['reviewer'], edit: ['approver'] });

      const result = await setWorkflowAccess(
        { namespace: NAMESPACE, name: WORKFLOW, access: { run: [], edit: [] } },
        buildScope({ membership: 'owner' }),
      );

      expect(result.caller).toEqual({ mayRun: true, mayEdit: true });
      expect(await processRepo.getWorkflowAccess(NAMESPACE, WORKFLOW)).toEqual({
        run: [],
        edit: [],
      });
    });

    it('404s for a workflow that does not exist, so no invisible row is written', async () => {
      await expect(
        setWorkflowAccess(
          { namespace: NAMESPACE, name: 'no-such-flow', access: { run: ['reviewer'], edit: [] } },
          buildScope({ membership: 'admin' }),
        ),
      ).rejects.toMatchObject({ code: 'not_found' });
    });
  });

  describe('the edit verb', () => {
    it('refuses every covered mutation to a member holding none of its roles', async () => {
      await gate({ edit: ['approver'] });
      const scope = buildScope();

      await expect(
        setWorkflowVisibility(
          { namespace: NAMESPACE, name: WORKFLOW, visibility: 'public' },
          scope,
        ),
      ).rejects.toMatchObject({ code: 'forbidden' });
      await expect(
        archiveWorkflow({ namespace: NAMESPACE, name: WORKFLOW, archived: true }, scope),
      ).rejects.toMatchObject({ code: 'forbidden' });
      await expect(
        archiveWorkflowVersion(
          { namespace: NAMESPACE, name: WORKFLOW, version: 1, archived: true },
          scope,
        ),
      ).rejects.toMatchObject({ code: 'forbidden' });
      await expect(
        deleteWorkflow({ namespace: NAMESPACE, name: WORKFLOW, expectedRunCount: 0 }, scope),
      ).rejects.toMatchObject({ code: 'forbidden' });
      await expect(
        setDefaultWorkflowVersion({ namespace: NAMESPACE, name: WORKFLOW, version: 1 }, scope),
      ).rejects.toMatchObject({ code: 'forbidden' });
      await expect(
        transferWorkflowNamespace(
          { name: WORKFLOW, sourceNamespace: NAMESPACE, targetNamespace: 'other-team' },
          scope,
        ),
      ).rejects.toMatchObject({ code: 'forbidden' });

      // Nothing was written on the way to any of those refusals.
      const stored = await processRepo.getWorkflowDefinition(NAMESPACE, WORKFLOW, 1);
      expect(stored?.visibility).toBe('private');
      expect(stored?.archived).not.toBe(true);
      expect(auditRepo.getAll()).toHaveLength(0);
    });

    it('names the required role in the refusal, not just "forbidden"', async () => {
      await gate({ edit: ['approver'] });

      await expect(
        archiveWorkflow({ namespace: NAMESPACE, name: WORKFLOW, archived: true }, buildScope()),
      ).rejects.toThrow(/Changing this workflow requires 'approver'/);
    });

    it('admits a holder of the listed role', async () => {
      await gate({ edit: ['approver'] });

      const result = await archiveWorkflow(
        { namespace: NAMESPACE, name: WORKFLOW, archived: true },
        buildScope({ processRoles: ['approver'] }),
      );

      expect(result.archived).toBe(true);
    });

    it('leaves an unconfigured workflow open to any member', async () => {
      const result = await setWorkflowVisibility(
        { namespace: NAMESPACE, name: WORKFLOW, visibility: 'public' },
        buildScope(),
      );

      expect(result.visibility).toBe('public');
    });

    it('does not gate on the run list', async () => {
      await gate({ run: ['reviewer'] });

      const result = await archiveWorkflow(
        { namespace: NAMESPACE, name: WORKFLOW, archived: true },
        buildScope(),
      );

      expect(result.archived).toBe(true);
    });

    it('bypasses a system actor — the CLI and the engine hold no roles', async () => {
      await gate({ edit: ['approver'] });

      const result = await archiveWorkflow(
        { namespace: NAMESPACE, name: WORKFLOW, archived: true },
        buildScope({ systemActor: true }),
      );

      expect(result.archived).toBe(true);
    });

    it('404 still beats 403 for a name that does not exist', async () => {
      await gate({ edit: ['approver'] });

      await expect(
        archiveWorkflow({ namespace: NAMESPACE, name: 'no-such-flow', archived: true }, buildScope()),
      ).rejects.toMatchObject({ code: 'not_found' });
    });
  });

  describe('cascades', () => {
    it('deleting the workflow drops its access, so a re-registered name is not born gated', async () => {
      await gate({ run: ['reviewer'], edit: ['approver'] });

      await deleteWorkflow(
        { namespace: NAMESPACE, name: WORKFLOW, expectedRunCount: 0 },
        buildScope({ processRoles: ['approver'] }),
      );

      expect(await processRepo.getWorkflowAccess(NAMESPACE, WORKFLOW)).toEqual({
        run: [],
        edit: [],
      });
    });

    it('a copy that stays in the workspace inherits the gate, so copying cannot launder it', async () => {
      await gate({ run: ['reviewer'], edit: ['approver'] });

      await copyWorkflow(
        { name: WORKFLOW, targetName: 'gated-flow-2', targetNamespace: NAMESPACE },
        buildScope(),
      );

      // A plain member may still copy — the capability is untouched — but the
      // copy is not an ungated back door onto the same process.
      expect(await processRepo.getWorkflowAccess(NAMESPACE, 'gated-flow-2')).toEqual({
        run: ['reviewer'],
        edit: ['approver'],
      });
    });

    it('a copy into another workspace carries nothing, because a role name means someone else there', async () => {
      await gate({ run: ['reviewer'], edit: ['approver'] });

      await copyWorkflow(
        { name: WORKFLOW, targetNamespace: 'other-team', sourceNamespace: NAMESPACE },
        buildScope(),
      );

      expect(await processRepo.getWorkflowAccess('other-team', WORKFLOW)).toEqual({
        run: [],
        edit: [],
      });
    });

    it('transferring the workflow leaves its access behind rather than carrying role names across', async () => {
      await gate({ run: ['reviewer'], edit: ['approver'] });

      await transferWorkflowNamespace(
        { name: WORKFLOW, sourceNamespace: NAMESPACE, targetNamespace: 'other-team' },
        buildScope({ processRoles: ['approver'] }),
      );

      expect(await processRepo.getWorkflowAccess(NAMESPACE, WORKFLOW)).toEqual({
        run: [],
        edit: [],
      });
      expect(await processRepo.getWorkflowAccess('other-team', WORKFLOW)).toEqual({
        run: [],
        edit: [],
      });
    });
  });
});
