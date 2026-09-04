import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  InMemoryHumanTaskRepository,
  InMemoryProcessInstanceRepository,
  InMemoryProcessRepository,
  buildHumanTask,
  buildProcessInstance,
  buildWorkflowDefinition,
  resetFactorySequence,
} from '@mediforce/platform-core/testing';
import type { HumanTask, UserDirectoryService, WorkflowStep } from '@mediforce/platform-core';
import { listTasks } from '../list-tasks';
import { stubUserDirectory } from '../../../testing/stub-user-directory';
import { createTestScope, userCaller } from '../../../repositories/__tests__/create-test-scope';

/**
 * The `actionable` axis (#1251): which tasks the caller can act on, decided by
 * the same rule `assertCallerMayActOnTask` enforces on the claim.
 *
 * Driven through `listTasks` rather than `filterActionable` directly — the
 * handler is the filter's only caller, and the order it composes in (the free
 * filters first, the one that costs reads on what is left) is part of what
 * these assert.
 *
 * The L3 journey (`e2e/api/task-inbox-actionable.journey.ts`) proves the same
 * narrowing through real Postgres, middleware and session cookies. These pin
 * what is invisible from the HTTP surface: that the roles come off the pinned
 * definition rather than `HumanTask.assignedRole`, and that resolving an inbox
 * costs reads per distinct workflow version, not per task.
 */

const NAMESPACE = 'team-alpha';
const REVIEW_WORKFLOW = 'vendor-review';
const OPEN_WORKFLOW = 'vendor-intake';
const HOLDER = 'u-reviewer';
const OUTSIDER = 'u-plain';

function humanStep(allowedRoles?: string[]): WorkflowStep {
  return {
    id: 'approve',
    name: 'Approve',
    type: 'review',
    executor: 'human',
    ...(allowedRoles === undefined ? {} : { allowedRoles }),
  };
}

describe('listTasks — actionable axis', () => {
  let instanceRepo: InMemoryProcessInstanceRepository;
  let humanTaskRepo: InMemoryHumanTaskRepository;
  let processRepo: InMemoryProcessRepository;

  beforeEach(async () => {
    resetFactorySequence();
    instanceRepo = new InMemoryProcessInstanceRepository();
    humanTaskRepo = new InMemoryHumanTaskRepository(instanceRepo);
    processRepo = new InMemoryProcessRepository();

    for (const [name, allowedRoles] of [
      [REVIEW_WORKFLOW, ['reviewer', 'approver']],
      [OPEN_WORKFLOW, undefined],
    ] as const) {
      await processRepo.saveWorkflowDefinition(
        buildWorkflowDefinition({
          name,
          namespace: NAMESPACE,
          version: 3,
          steps: [
            humanStep(allowedRoles === undefined ? undefined : [...allowedRoles]),
            { id: 'done', name: 'Done', type: 'terminal', executor: 'human' },
          ],
          transitions: [{ from: 'approve', to: 'done' }],
        }),
      );
    }
  });

  async function seedRun(id: string, definitionName: string): Promise<void> {
    await instanceRepo.create(
      buildProcessInstance({
        id,
        namespace: NAMESPACE,
        definitionName,
        definitionVersion: '3',
      }),
    );
  }

  async function seedTask(overrides: Partial<HumanTask>): Promise<HumanTask> {
    const task = buildHumanTask({ stepId: 'approve', status: 'pending', ...overrides });
    await humanTaskRepo.create(task);
    return task;
  }

  function scopeFor(
    uid: string,
    processRoles?: ReadonlyMap<string, ReadonlySet<string>>,
    directory: UserDirectoryService = stubUserDirectory(),
  ) {
    return createTestScope({
      instanceRepo,
      humanTaskRepo,
      processRepo,
      userDirectory: directory,
      caller: userCaller(uid, [NAMESPACE], undefined, processRoles),
    });
  }

  const holdsReviewer = new Map([[NAMESPACE, new Set(['reviewer'])]]);

  describe('the role predicate', () => {
    beforeEach(async () => {
      await seedRun('inst-gated', REVIEW_WORKFLOW);
      await seedTask({ id: 't-gated', processInstanceId: 'inst-gated' });
    });

    it('keeps a gated task for a workspace-wide holder of the role', async () => {
      const result = await listTasks({ actionable: true }, scopeFor(HOLDER, holdsReviewer));

      expect(result.tasks.map((task) => task.id)).toEqual(['t-gated']);
    });

    it('drops the same task for a member holding none of the roles', async () => {
      const result = await listTasks({ actionable: true }, scopeFor(OUTSIDER));

      expect(result.tasks).toEqual([]);
    });

    /**
     * `HumanTask.assignedRole` carries only `allowedRoles[0]`, so an inbox
     * reading the task would drop the holder of a step's second allowed role —
     * the truncation #1249 kept out of the gate, kept out of the inbox here.
     */
    it('[REGRESSION #1251] keeps the task for a holder of the step’s second role', async () => {
      const holdsApprover = new Map([[NAMESPACE, new Set(['approver'])]]);

      const result = await listTasks({ actionable: true }, scopeFor(HOLDER, holdsApprover));

      expect(result.tasks.map((task) => task.id)).toEqual(['t-gated']);
    });

    it('drops it for a holder whose grant is narrowed to another workflow', async () => {
      const directory = stubUserDirectory({
        // A `reviewer` grant on `vendor-intake` has nothing to say about
        // `vendor-review`.
        async getGrantsForUser() {
          return [{ role: 'reviewer', workflowName: OPEN_WORKFLOW }];
        },
      });

      const result = await listTasks({ actionable: true }, scopeFor(HOLDER, undefined, directory));

      expect(result.tasks).toEqual([]);
    });

    it('keeps it for a holder whose grant is narrowed to this workflow', async () => {
      const directory = stubUserDirectory({
        async getGrantsForUser() {
          return [{ role: 'reviewer', workflowName: REVIEW_WORKFLOW }];
        },
      });

      const result = await listTasks({ actionable: true }, scopeFor(HOLDER, undefined, directory));

      expect(result.tasks.map((task) => task.id)).toEqual(['t-gated']);
    });

    it('keeps a gated task for a workflow-manager the step never named', async () => {
      const holdsManager = new Map([[NAMESPACE, new Set(['workflow-manager'])]]);

      // The inbox reads the same `resolveStepGate` the claim is gated on, so
      // the standing role of ADR-0020 reaches both or neither — a task the
      // server would let them complete has to be listed as theirs.
      const result = await listTasks({ actionable: true }, scopeFor(HOLDER, holdsManager));

      expect(result.tasks.map((task) => task.id)).toEqual(['t-gated']);
    });

    it('keeps a task whose step declares no allowedRoles', async () => {
      await seedRun('inst-open', OPEN_WORKFLOW);
      await seedTask({ id: 't-open', processInstanceId: 'inst-open' });

      const result = await listTasks({ actionable: true }, scopeFor(OUTSIDER));

      expect(result.tasks.map((task) => task.id)).toEqual(['t-open']);
    });

    /**
     * The pinned version is unreadable — deleted, or transferred away. The gate
     * refuses the claim, so the inbox must not offer the task either.
     */
    it('drops a task whose run is pinned to a definition that cannot be read', async () => {
      await seedRun('inst-orphan', 'workflow-that-left');
      await seedTask({ id: 't-orphan', processInstanceId: 'inst-orphan' });

      const result = await listTasks({ actionable: true }, scopeFor(HOLDER, holdsReviewer));

      expect(result.tasks.map((task) => task.id)).toEqual(['t-gated']);
    });
  });

  describe('the assignment predicate', () => {
    beforeEach(async () => {
      await seedRun('inst-gated', REVIEW_WORKFLOW);
    });

    it('keeps a task claimed by the caller, whatever roles they hold', async () => {
      await seedTask({
        id: 't-mine',
        processInstanceId: 'inst-gated',
        status: 'claimed',
        assignedUserId: OUTSIDER,
      });

      const result = await listTasks({ actionable: true }, scopeFor(OUTSIDER));

      expect(result.tasks.map((task) => task.id)).toEqual(['t-mine']);
    });

    it('drops a pending task pinned to somebody else', async () => {
      await seedTask({
        id: 't-theirs',
        processInstanceId: 'inst-gated',
        assignedUserId: 'u-somebody-else',
      });

      const result = await listTasks({ actionable: true }, scopeFor(HOLDER, holdsReviewer));

      expect(result.tasks).toEqual([]);
    });
  });

  describe('what the axis does not change', () => {
    beforeEach(async () => {
      await seedRun('inst-gated', REVIEW_WORKFLOW);
      await seedTask({ id: 't-gated', processInstanceId: 'inst-gated' });
      await seedTask({
        id: 't-theirs',
        processInstanceId: 'inst-gated',
        assignedUserId: 'u-somebody-else',
      });
    });

    it('returns the unfiltered list when the flag is omitted', async () => {
      const result = await listTasks({}, scopeFor(OUTSIDER));

      expect(result.tasks.map((task) => task.id).sort()).toEqual(['t-gated', 't-theirs']);
    });

    it('returns the unfiltered list when the flag is false', async () => {
      const result = await listTasks({ actionable: false }, scopeFor(OUTSIDER));

      expect(result.tasks.map((task) => task.id).sort()).toEqual(['t-gated', 't-theirs']);
    });

    it('is a no-op for a system actor, which holds no roles and has no inbox', async () => {
      const scope = createTestScope({ instanceRepo, humanTaskRepo, processRepo });

      const result = await listTasks({ actionable: true }, scope);

      expect(result.tasks.map((task) => task.id).sort()).toEqual(['t-gated', 't-theirs']);
    });

    it('composes with the status filter rather than replacing it', async () => {
      await seedTask({
        id: 't-done',
        processInstanceId: 'inst-gated',
        status: 'completed',
        assignedUserId: HOLDER,
      });

      const result = await listTasks(
        { actionable: true, status: ['completed'] },
        scopeFor(HOLDER, holdsReviewer),
      );

      expect(result.tasks.map((task) => task.id)).toEqual(['t-done']);
    });
  });

  /**
   * An inbox is many tasks over few workflows. The reads that answer it must
   * scale with the workflows, not the tasks — otherwise every poll of the
   * Human actions page fans out across the connection pool.
   */
  describe('read batching', () => {
    it('reads each run once, each pinned version once, and each role question once', async () => {
      for (let index = 0; index < 5; index += 1) {
        await seedRun(`inst-${index}`, index < 3 ? REVIEW_WORKFLOW : OPEN_WORKFLOW);
        // Two tasks per run, so a per-task read is distinguishable from a
        // per-run one.
        await seedTask({ id: `t-${index}-a`, processInstanceId: `inst-${index}` });
        await seedTask({ id: `t-${index}-b`, processInstanceId: `inst-${index}` });
      }

      const getGrantsForUser = vi.fn(async () => []);
      const scope = scopeFor(OUTSIDER, undefined, stubUserDirectory({ getGrantsForUser }));
      const pins = vi.spyOn(scope.runs, 'getDefinitionPins');
      const definitions = vi.spyOn(scope.workflowDefinitions, 'get');

      const result = await listTasks({ actionable: true }, scope);

      // The four `vendor-intake` tasks: that workflow gates nothing.
      expect(result.tasks.map((task) => task.id).sort()).toEqual([
        't-3-a',
        't-3-b',
        't-4-a',
        't-4-b',
      ]);
      expect(pins).toHaveBeenCalledTimes(1);
      expect(pins.mock.calls[0]?.[0]).toHaveLength(5);
      // Five runs, two distinct pinned versions.
      expect(definitions).toHaveBeenCalledTimes(2);
      // Six gated tasks, one `(uid, workspace)` read between them: the memoized
      // directory reads the caller's grants once and answers every workflow
      // from that, so the count no longer grows with the gated workflows either.
      expect(getGrantsForUser).toHaveBeenCalledTimes(1);
    });
  });
});
