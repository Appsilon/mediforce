import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  InMemoryAuditRepository,
  InMemoryProcessInstanceRepository,
  InMemoryProcessRepository,
  buildProcessInstance,
  buildWorkflowDefinition,
  resetFactorySequence,
} from '@mediforce/platform-core/testing';
import { ListRunsInputSchema } from '../../../contract/runs';
import { startRun } from '../start-run';
import { listRuns } from '../list-runs';
import { getRun } from '../get-run';
import { createTestScope, userCaller } from '../../../repositories/__tests__/create-test-scope';
import { noopRunKicker } from '../../../runtime/run-kicker';

describe('dry run', () => {
  let processRepo: InMemoryProcessRepository;
  let instanceRepo: InMemoryProcessInstanceRepository;
  let auditRepo: InMemoryAuditRepository;

  beforeEach(() => {
    resetFactorySequence();
    processRepo = new InMemoryProcessRepository();
    instanceRepo = new InMemoryProcessInstanceRepository();
    auditRepo = new InMemoryAuditRepository(instanceRepo);
  });

  function seedWorkflow() {
    return processRepo.saveWorkflowDefinition(
      buildWorkflowDefinition({
        name: 'intake',
        namespace: 'team-alpha',
        version: 1,
      }),
    );
  }

  function makeScope(opts?: { dryRunInstance?: boolean }) {
    const inst = buildProcessInstance({
      id: 'inst-new',
      namespace: 'team-alpha',
      dryRun: opts?.dryRunInstance ?? false,
    });
    const createPromise = instanceRepo.create(inst);

    const fireWorkflow = vi.fn().mockResolvedValue({
      instanceId: 'inst-new',
      status: 'created' as const,
    });
    const kicker = noopRunKicker();
    const scope = createTestScope({
      processRepo,
      instanceRepo,
      auditRepo,
      runKicker: kicker,
      caller: userCaller('u-1', ['team-alpha']),
    });
    Object.assign(scope.system, { manualTrigger: { fireWorkflow } });

    return { scope, fireWorkflow, kicker, createPromise };
  }

  describe('startRun', () => {
    it('passes dryRun: true to manualTrigger.fireWorkflow', async () => {
      await seedWorkflow();
      const { scope, fireWorkflow, createPromise } = makeScope();
      await createPromise;

      await startRun(
        {
          namespace: 'team-alpha',
          definitionName: 'intake',
          triggerName: 'manual',
          triggeredBy: 'u-1',
          dryRun: true,
        },
        scope,
      );

      expect(fireWorkflow).toHaveBeenCalledWith(expect.objectContaining({ dryRun: true }));
    });

    it('omits dryRun from fireWorkflow when not set', async () => {
      await seedWorkflow();
      const { scope, fireWorkflow, createPromise } = makeScope();
      await createPromise;

      await startRun(
        {
          namespace: 'team-alpha',
          definitionName: 'intake',
          triggerName: 'manual',
          triggeredBy: 'u-1',
        },
        scope,
      );

      const call = fireWorkflow.mock.calls[0][0];
      expect(call.dryRun).toBeUndefined();
    });

    it('returns run with dryRun: true when started as dry run', async () => {
      await seedWorkflow();
      const { scope, createPromise } = makeScope({ dryRunInstance: true });
      await createPromise;

      const result = await startRun(
        {
          namespace: 'team-alpha',
          definitionName: 'intake',
          triggerName: 'manual',
          triggeredBy: 'u-1',
          dryRun: true,
        },
        scope,
      );

      expect(result.run.dryRun).toBe(true);
    });
  });

  describe('listRuns', () => {
    it('returns all runs when dryRun filter omitted', async () => {
      await instanceRepo.create(buildProcessInstance({ id: 'r-prod', dryRun: false }));
      await instanceRepo.create(buildProcessInstance({ id: 'r-dry', dryRun: true }));

      const scope = createTestScope({ instanceRepo });
      const result = await listRuns({ limit: 20 }, scope);

      expect(result.runs.map((r) => r.id).sort()).toEqual(['r-dry', 'r-prod']);
    });

    it('returns only dry runs when dryRun: true', async () => {
      await instanceRepo.create(buildProcessInstance({ id: 'r-prod', dryRun: false }));
      await instanceRepo.create(buildProcessInstance({ id: 'r-dry', dryRun: true }));

      const scope = createTestScope({ instanceRepo });
      const result = await listRuns({ dryRun: true, limit: 20 }, scope);

      expect(result.runs.map((r) => r.id)).toEqual(['r-dry']);
    });

    it('returns only production runs when dryRun: false', async () => {
      await instanceRepo.create(buildProcessInstance({ id: 'r-prod', dryRun: false }));
      await instanceRepo.create(buildProcessInstance({ id: 'r-dry', dryRun: true }));

      const scope = createTestScope({ instanceRepo });
      const result = await listRuns({ dryRun: false, limit: 20 }, scope);

      expect(result.runs.map((r) => r.id)).toEqual(['r-prod']);
    });
  });

  describe('ListRunsInputSchema coercion', () => {
    it('parses string "false" as boolean false (not truthy)', () => {
      const parsed = ListRunsInputSchema.parse({ dryRun: 'false' });
      expect(parsed.dryRun).toBe(false);
    });

    it('parses string "true" as boolean true', () => {
      const parsed = ListRunsInputSchema.parse({ dryRun: 'true' });
      expect(parsed.dryRun).toBe(true);
    });

    it('leaves dryRun undefined when omitted', () => {
      const parsed = ListRunsInputSchema.parse({});
      expect(parsed.dryRun).toBeUndefined();
    });
  });

  describe('getRun', () => {
    it('includes dryRun: true in output for dry runs', async () => {
      await instanceRepo.create(buildProcessInstance({ id: 'r1', namespace: 'alpha', dryRun: true }));

      const scope = createTestScope({ instanceRepo, processRepo });
      const result = await getRun({ runId: 'r1' }, scope);

      expect(result.dryRun).toBe(true);
    });

    it('omits dryRun from output for normal runs', async () => {
      await instanceRepo.create(buildProcessInstance({ id: 'r1', namespace: 'alpha', dryRun: false }));

      const scope = createTestScope({ instanceRepo, processRepo });
      const result = await getRun({ runId: 'r1' }, scope);

      expect(result.dryRun).toBeUndefined();
    });
  });
});
