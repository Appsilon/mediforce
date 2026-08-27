import { describe, it, expect, beforeEach } from 'vitest';
import {
  InMemoryHumanTaskRepository,
  InMemoryProcessInstanceRepository,
  InMemoryProcessRepository,
  buildHumanTask,
  buildProcessInstance,
  buildWorkflowDefinition,
  resetFactorySequence,
} from '@mediforce/platform-core/testing';
import type { HumanTask, WorkflowStep } from '@mediforce/platform-core';
import { assertCallerMayActOnTask } from '../_role-gate';
import { stubUserDirectory } from '../../../testing/stub-user-directory';
import { ForbiddenError } from '../../../errors';
import { createTestScope, userCaller } from '../../../repositories/__tests__/create-test-scope';

/**
 * Unit coverage for the step role gate (ADR-0019, #1249). The L3 journey
 * (`e2e/api/task-role-gate.journey.ts`) proves the same rules through real
 * Postgres, middleware and session cookies; these pin the resolution rules
 * that are invisible from the HTTP surface — above all that `allowedRoles`
 * comes from the pinned definition, never from `HumanTask.assignedRole`.
 */

const NAMESPACE = 'team-alpha';
const WORKFLOW = 'vendor-review';

describe('assertCallerMayActOnTask', () => {
  let instanceRepo: InMemoryProcessInstanceRepository;
  let humanTaskRepo: InMemoryHumanTaskRepository;
  let processRepo: InMemoryProcessRepository;

  beforeEach(async () => {
    resetFactorySequence();
    instanceRepo = new InMemoryProcessInstanceRepository();
    humanTaskRepo = new InMemoryHumanTaskRepository(instanceRepo);
    processRepo = new InMemoryProcessRepository();
    await instanceRepo.create(
      buildProcessInstance({
        id: 'inst-a',
        namespace: NAMESPACE,
        definitionName: WORKFLOW,
        definitionVersion: '3',
      }),
    );
  });

  /** Register the pinned definition the seeded run points at. */
  async function pinDefinition(step: WorkflowStep): Promise<void> {
    await processRepo.saveWorkflowDefinition(
      buildWorkflowDefinition({
        name: WORKFLOW,
        namespace: NAMESPACE,
        version: 3,
        steps: [step, { id: 'done', name: 'Done', type: 'terminal', executor: 'human' }],
        transitions: [{ from: step.id, to: 'done' }],
      }),
    );
  }

  async function seedTask(overrides: Partial<HumanTask> = {}): Promise<HumanTask> {
    const task = buildHumanTask({
      id: 'task-1',
      processInstanceId: 'inst-a',
      stepId: 'approve',
      status: 'pending',
      ...overrides,
    });
    await humanTaskRepo.create(task);
    return task;
  }

  function scopeFor(
    processRoles: ReadonlyMap<string, ReadonlySet<string>>,
    directory = stubUserDirectory(),
  ) {
    return createTestScope({
      instanceRepo,
      humanTaskRepo,
      processRepo,
      userDirectory: directory,
      caller: userCaller('u-1', [NAMESPACE], undefined, processRoles),
    });
  }

  const humanStep = (allowedRoles?: string[]): WorkflowStep => ({
    id: 'approve',
    name: 'Approve',
    type: 'review',
    executor: 'human',
    ...(allowedRoles === undefined ? {} : { allowedRoles }),
  });

  it('leaves a step with no allowedRoles open to any workspace member', async () => {
    await pinDefinition(humanStep());
    const task = await seedTask();

    await expect(
      assertCallerMayActOnTask(scopeFor(new Map()), task),
    ).resolves.toBeUndefined();
  });

  it('admits a workspace-wide holder without consulting the directory', async () => {
    await pinDefinition(humanStep(['reviewer']));
    const task = await seedTask();
    let directoryReads = 0;
    const directory = stubUserDirectory({
      async getRolesForUser() {
        directoryReads += 1;
        return [];
      },
    });

    await assertCallerMayActOnTask(
      scopeFor(new Map([[NAMESPACE, new Set(['reviewer'])]]), directory),
      task,
    );

    expect(directoryReads).toBe(0);
  });

  it('refuses a member holding none of the listed roles', async () => {
    await pinDefinition(humanStep(['reviewer']));
    const task = await seedTask();
    const directory = stubUserDirectory({
      async getUsersByRoleInNamespace() {
        return [{ uid: 'someone-else', email: 'reviewer@example.com' }];
      },
    });

    await expect(
      assertCallerMayActOnTask(
        scopeFor(new Map([[NAMESPACE, new Set(['author'])]]), directory),
        task,
      ),
    ).rejects.toThrow(ForbiddenError);
  });

  // The regression the issue is named for: the engine writes only
  // `allowedRoles[0]` into `HumanTask.assignedRole`, so a gate reading the
  // task would enforce 'reviewer' alone and silently drop 'approver'.
  it('honours the second of two allowedRoles, which assignedRole cannot carry', async () => {
    await pinDefinition(humanStep(['reviewer', 'approver']));
    const task = await seedTask({ assignedRole: 'reviewer' });

    await expect(
      assertCallerMayActOnTask(scopeFor(new Map([[NAMESPACE, new Set(['approver'])]])), task),
    ).resolves.toBeUndefined();
  });

  it('admits a grant narrowed to this workflow, which the caller identity cannot carry', async () => {
    await pinDefinition(humanStep(['reviewer']));
    const task = await seedTask();
    const directory = stubUserDirectory({
      async getRolesForUser(_uid, _namespace, workflowName) {
        return workflowName === WORKFLOW ? ['reviewer'] : [];
      },
    });

    await expect(
      assertCallerMayActOnTask(scopeFor(new Map(), directory), task),
    ).resolves.toBeUndefined();
  });

  it('refuses a grant narrowed to a different workflow', async () => {
    await pinDefinition(humanStep(['reviewer']));
    const task = await seedTask();
    const directory = stubUserDirectory({
      async getRolesForUser(_uid, _namespace, workflowName) {
        return workflowName === 'some-other-workflow' ? ['reviewer'] : [];
      },
    });

    await expect(
      assertCallerMayActOnTask(scopeFor(new Map(), directory), task),
    ).rejects.toThrow(ForbiddenError);
  });

  it('names the cause and the fix when the workspace has no holder of the role', async () => {
    await pinDefinition(humanStep(['reviewer']));
    const task = await seedTask();

    await expect(
      assertCallerMayActOnTask(scopeFor(new Map(), stubUserDirectory()), task),
    ).rejects.toThrow(
      "No one in this workspace holds 'reviewer'. An admin can assign it in workspace Settings → Members.",
    );
  });

  it('names the roles required and the roles held when someone else holds them', async () => {
    await pinDefinition(humanStep(['reviewer']));
    const task = await seedTask();
    const directory = stubUserDirectory({
      async getRolesForUser() {
        return ['author'];
      },
      async getUsersByRoleInNamespace() {
        return [{ uid: 'u-2', email: 'reviewer@example.com' }];
      },
    });

    await expect(
      assertCallerMayActOnTask(scopeFor(new Map(), directory), task),
    ).rejects.toThrow("This step requires 'reviewer'; you hold 'author'.");
  });

  it('bypasses the gate for a system actor', async () => {
    await pinDefinition(humanStep(['reviewer']));
    const task = await seedTask();
    const scope = createTestScope({ instanceRepo, humanTaskRepo, processRepo });

    await expect(assertCallerMayActOnTask(scope, task)).resolves.toBeUndefined();
  });

  // A step the pinned definition does not describe carries no restriction the
  // author wrote, so it behaves exactly as it did before the gate existed.
  it('leaves a task whose step is absent from the pinned definition ungated', async () => {
    await pinDefinition(humanStep(['reviewer']));
    const task = await seedTask({ stepId: 'step-that-no-longer-exists' });

    await expect(
      assertCallerMayActOnTask(scopeFor(new Map()), task),
    ).resolves.toBeUndefined();
  });

  // The opposite of the case above: nothing readable says what the author
  // wrote, so the gate refuses instead of guessing.
  it('refuses when the pinned definition version cannot be read', async () => {
    const task = await seedTask();

    await expect(
      assertCallerMayActOnTask(scopeFor(new Map()), task),
    ).rejects.toThrow(/not readable in this workspace/);
  });

  // `transferWorkflowNamespace` rewrites the definition's workspace and leaves
  // the run's `namespace` on the source, so the pinned read comes back empty
  // for every in-flight run. Failing open there would hand anyone who can
  // transfer a workflow a way to un-gate its steps.
  it('refuses after the workflow is transferred out of the run\'s workspace', async () => {
    await processRepo.saveWorkflowDefinition(
      buildWorkflowDefinition({
        name: WORKFLOW,
        namespace: 'somewhere-else',
        version: 3,
        steps: [humanStep(['reviewer']), { id: 'done', name: 'Done', type: 'terminal', executor: 'human' }],
        transitions: [{ from: 'approve', to: 'done' }],
      }),
    );
    const task = await seedTask();

    await expect(
      assertCallerMayActOnTask(scopeFor(new Map([[NAMESPACE, new Set(['reviewer'])]])), task),
    ).rejects.toThrow(ForbiddenError);
  });

  it('names every required role when a step lists more than one', async () => {
    await pinDefinition(humanStep(['reviewer', 'approver']));
    const task = await seedTask();

    await expect(
      assertCallerMayActOnTask(scopeFor(new Map(), stubUserDirectory()), task),
    ).rejects.toThrow(
      "No one in this workspace holds any of 'reviewer', 'approver'. An admin can assign one in workspace Settings → Members.",
    );
  });

  it('says so plainly when the caller holds no roles at all', async () => {
    await pinDefinition(humanStep(['reviewer']));
    const task = await seedTask();
    const directory = stubUserDirectory({
      async getUsersByRoleInNamespace() {
        return [{ uid: 'u-2', email: 'reviewer@example.com' }];
      },
    });

    await expect(
      assertCallerMayActOnTask(scopeFor(new Map(), directory), task),
    ).rejects.toThrow("This step requires 'reviewer'; you hold no roles in this workspace.");
  });
  // Version numbering restarts at 1 once the last version leaves a workspace,
  // so registering the transferred (or deleted) name again plants a definition
  // an in-flight run's pin resolves to. Resolving is not enough: the pinned
  // version cannot have been written after the run that pinned it.
  it("refuses when the pin resolves to a workflow registered after the run started", async () => {
    await processRepo.saveWorkflowDefinition(
      buildWorkflowDefinition({
        name: WORKFLOW,
        namespace: NAMESPACE,
        version: 3,
        createdAt: '2026-06-01T10:00:00Z',
        steps: [humanStep(), { id: 'done', name: 'Done', type: 'terminal', executor: 'human' }],
        transitions: [{ from: 'approve', to: 'done' }],
      }),
    );
    const task = await seedTask();

    await expect(
      assertCallerMayActOnTask(scopeFor(new Map()), task),
    ).rejects.toThrow(/registered under the same name after this run started/);
  });

  it('admits on a pinned definition registered before the run', async () => {
    await processRepo.saveWorkflowDefinition(
      buildWorkflowDefinition({
        name: WORKFLOW,
        namespace: NAMESPACE,
        version: 3,
        createdAt: '2026-01-01T10:00:00Z',
        steps: [humanStep(), { id: 'done', name: 'Done', type: 'terminal', executor: 'human' }],
        transitions: [{ from: 'approve', to: 'done' }],
      }),
    );
    const task = await seedTask();

    await expect(
      assertCallerMayActOnTask(scopeFor(new Map()), task),
    ).resolves.toBeUndefined();
  });

  // Nothing bounds `allowedRoles` at authoring time and any member can register
  // a workflow, so the refusal path must not turn a crafted list into one
  // directory read per entry.
  it('probes a repeated role once when deciding nobody holds it', async () => {
    await pinDefinition(humanStep(['reviewer', 'reviewer', 'reviewer']));
    const task = await seedTask();
    let probes = 0;
    const directory = stubUserDirectory({
      async getUsersByRoleInNamespace() {
        probes += 1;
        return [];
      },
    });

    await expect(
      assertCallerMayActOnTask(scopeFor(new Map(), directory), task),
    ).rejects.toThrow(
      "No one in this workspace holds 'reviewer'. An admin can assign it in workspace Settings → Members.",
    );
    expect(probes).toBe(1);
  });

  it('skips the zero-holder probe on a step naming more roles than the bound', async () => {
    const manyRoles = Array.from({ length: 9 }, (_, index) => `role-${index}`);
    await pinDefinition(humanStep(manyRoles));
    const task = await seedTask();
    let probes = 0;
    const directory = stubUserDirectory({
      async getUsersByRoleInNamespace() {
        probes += 1;
        return [];
      },
    });

    await expect(
      assertCallerMayActOnTask(scopeFor(new Map(), directory), task),
    ).rejects.toThrow('you hold no roles in this workspace.');
    expect(probes).toBe(0);
  });
});
