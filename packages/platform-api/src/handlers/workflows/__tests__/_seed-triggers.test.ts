import { describe, it, expect, beforeEach } from 'vitest';
import {
  InMemoryAuditRepository,
  InMemoryProcessInstanceRepository,
  InMemoryProcessRepository,
  InMemoryTriggerRepository,
} from '@mediforce/platform-core/testing';
import { MANUAL_TRIGGER_NAME, seedManualTrigger } from '../_seed-triggers';
import { createTestScope, userCaller } from '../../../repositories/__tests__/create-test-scope';

describe('seedManualTrigger (ADR-0011 / Issue #930, #932)', () => {
  let triggerRepo: InMemoryTriggerRepository;

  beforeEach(() => {
    triggerRepo = new InMemoryTriggerRepository();
  });

  function scope() {
    return createTestScope({
      processRepo: new InMemoryProcessRepository(),
      auditRepo: new InMemoryAuditRepository(new InMemoryProcessInstanceRepository()),
      triggerRepo,
      caller: userCaller('u-1', ['team-alpha']),
    });
  }

  it('seeds an enabled manual singleton named "manual"', async () => {
    await seedManualTrigger(scope(), 'team-alpha', 'flow');

    const rows = await triggerRepo.listByWorkflow('team-alpha', 'flow');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ type: 'manual', name: MANUAL_TRIGGER_NAME, enabled: true, config: {} });
    expect(rows[0].type === 'manual' && rows[0].lastTriggeredAt).toBeNull();
  });

  it('never creates a second manual row when one already exists', async () => {
    const now = new Date().toISOString();
    await triggerRepo.create({
      type: 'manual',
      namespace: 'team-alpha',
      workflowName: 'flow',
      name: 'legacy',
      enabled: false,
      config: {},
      lastTriggeredAt: null,
      createdAt: now,
      updatedAt: now,
    });

    await seedManualTrigger(scope(), 'team-alpha', 'flow');

    const manual = (await triggerRepo.listByWorkflow('team-alpha', 'flow')).filter(
      (t) => t.type === 'manual',
    );
    expect(manual).toHaveLength(1);
    expect(manual[0].name).toBe('legacy');
    expect(manual[0].enabled).toBe(false);
  });

  it('seeds only the manual singleton — cron/webhook are not derived from the workflow (Issue #932)', async () => {
    await seedManualTrigger(scope(), 'team-alpha', 'flow');

    const rows = await triggerRepo.listByWorkflow('team-alpha', 'flow');
    expect(rows.map((t) => t.type)).toEqual(['manual']);
  });
});
