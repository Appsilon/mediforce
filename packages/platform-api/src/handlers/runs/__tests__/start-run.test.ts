import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  InMemoryAuditRepository,
  InMemoryProcessInstanceRepository,
  InMemoryProcessRepository,
  buildProcessInstance,
  buildWorkflowDefinition,
  resetFactorySequence,
} from '@mediforce/platform-core/testing';
import { startRun } from '../start-run';
import { HandlerError, NotFoundError } from '../../../errors';
import { createTestScope, userCaller } from '../../../repositories/__tests__/create-test-scope';
import { noopRunKicker } from '../../../runtime/run-kicker';

/**
 * Handler-level tests for `startRun`. The manual trigger is stubbed; engine
 * mechanics (instance creation + `instance.created`/`instance.started`
 * emission) live in `workflow-engine`'s manual-trigger tests. This file
 * covers the handler-resident bridge: WD lookup, payload validation,
 * workspace gating, post-fire entity echo, and run kick.
 */

describe('startRun handler', () => {
  let processRepo: InMemoryProcessRepository;
  let instanceRepo: InMemoryProcessInstanceRepository;
  let auditRepo: InMemoryAuditRepository;

  beforeEach(() => {
    resetFactorySequence();
    processRepo = new InMemoryProcessRepository();
    instanceRepo = new InMemoryProcessInstanceRepository();
    auditRepo = new InMemoryAuditRepository(instanceRepo);
  });

  it('fires the manual trigger and returns the created run, then kicks the runner', async () => {
    await processRepo.saveWorkflowDefinition(
      buildWorkflowDefinition({
        name: 'intake',
        namespace: 'team-alpha',
        version: 1,
      }),
    );
    await instanceRepo.create(buildProcessInstance({ id: 'inst-new', namespace: 'team-alpha' }));

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

    const result = await startRun(
      {
        namespace: 'team-alpha',
        definitionName: 'intake',
        triggerName: 'manual',
        triggeredBy: 'u-1',
      },
      scope,
    );

    expect(result.run.id).toBe('inst-new');
    expect(fireWorkflow).toHaveBeenCalledWith(
      expect.objectContaining({
        namespace: 'team-alpha',
        definitionName: 'intake',
        definitionVersion: 1,
        triggerName: 'manual',
        triggeredBy: 'u-1',
      }),
    );
    expect(kicker.kicks).toEqual([{ instanceId: 'inst-new', triggeredBy: 'u-1' }]);
  });

  it('throws NotFoundError when the definition name is unknown', async () => {
    const fireWorkflow = vi.fn();
    const scope = createTestScope({
      processRepo,
      instanceRepo,
      auditRepo,
      caller: userCaller('u-1', ['team-alpha']),
    });
    Object.assign(scope.system, { manualTrigger: { fireWorkflow } });

    await expect(
      startRun(
        {
          namespace: 'team-alpha',
          definitionName: 'does-not-exist',
          triggerName: 'manual',
          triggeredBy: 'u-1',
        },
        scope,
      ),
    ).rejects.toBeInstanceOf(NotFoundError);

    expect(fireWorkflow).not.toHaveBeenCalled();
  });

  it('rejects payload missing a required triggerInput field as validation HandlerError (400)', async () => {
    await processRepo.saveWorkflowDefinition(
      buildWorkflowDefinition({
        name: 'with-input',
        namespace: 'team-alpha',
        version: 1,
        triggerInput: [{ name: 'x', type: 'string', required: true }],
      }),
    );

    const fireWorkflow = vi.fn();
    const scope = createTestScope({
      processRepo,
      instanceRepo,
      auditRepo,
      caller: userCaller('u-1', ['team-alpha']),
    });
    Object.assign(scope.system, { manualTrigger: { fireWorkflow } });

    const err = await startRun(
      {
        namespace: 'team-alpha',
        definitionName: 'with-input',
        triggerName: 'manual',
        triggeredBy: 'u-1',
        payload: {},
      },
      scope,
    ).catch((e) => e);

    expect(err).toBeInstanceOf(HandlerError);
    expect((err as HandlerError).code).toBe('validation');
    expect(fireWorkflow).not.toHaveBeenCalled();
  });

  it('hides a private foreign-namespace WD from a non-member caller (anti-enum 404)', async () => {
    // The authorized WD wrapper returns null for a private WD outside the
    // caller's namespaces. The handler maps that null to NotFoundError, so
    // the user-visible outcome is 404 (not 403) — consistent with ADR-0005
    // §3 anti-enum.
    await processRepo.saveWorkflowDefinition(
      buildWorkflowDefinition({
        name: 'private-intake',
        namespace: 'team-beta',
        version: 1,
        visibility: 'private',
      }),
    );

    const fireWorkflow = vi.fn();
    const scope = createTestScope({
      processRepo,
      instanceRepo,
      auditRepo,
      caller: userCaller('u-1', ['team-alpha']), // not a member of team-beta
    });
    Object.assign(scope.system, { manualTrigger: { fireWorkflow } });

    await expect(
      startRun(
        {
          namespace: 'team-beta',
          definitionName: 'private-intake',
          triggerName: 'manual',
          triggeredBy: 'u-1',
        },
        scope,
      ),
    ).rejects.toBeInstanceOf(NotFoundError);

    expect(fireWorkflow).not.toHaveBeenCalled();
  });
});
