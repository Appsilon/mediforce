import { describe, it, expect, beforeEach } from 'vitest';
import {
  InMemoryAuditRepository,
  InMemoryProcessInstanceRepository,
  InMemoryProcessRepository,
  InMemoryTriggerRepository,
} from '@mediforce/platform-core/testing';
import type { WorkflowDefinition } from '@mediforce/platform-core';
import { MANUAL_TRIGGER_NAME, seedTriggersFromDefinition } from '../_seed-triggers';
import { createTestScope, userCaller } from '../../../repositories/__tests__/create-test-scope';

describe('seedTriggersFromDefinition (ADR-0011 / Issue #930)', () => {
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

  const def = (
    triggers: WorkflowDefinition['triggers'],
  ): Pick<WorkflowDefinition, 'name' | 'triggers'> => ({ name: 'flow', triggers });

  it('seeds an enabled manual singleton named "manual", independent of the definition', async () => {
    // Definition declares a differently-named manual trigger — the seed ignores
    // it and creates the canonical singleton.
    await seedTriggersFromDefinition(scope(), 'team-alpha', def([{ type: 'manual', name: 'Start Process' }]));

    const rows = await triggerRepo.listByWorkflow('team-alpha', 'flow');
    const manual = rows.filter((t) => t.type === 'manual');
    expect(manual).toHaveLength(1);
    expect(manual[0]).toMatchObject({ name: MANUAL_TRIGGER_NAME, enabled: true, config: {} });
    expect(manual[0].type === 'manual' && manual[0].lastTriggeredAt).toBeNull();
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

    await seedTriggersFromDefinition(scope(), 'team-alpha', def([{ type: 'manual', name: 'manual' }]));

    const manual = (await triggerRepo.listByWorkflow('team-alpha', 'flow')).filter(
      (t) => t.type === 'manual',
    );
    expect(manual).toHaveLength(1);
    expect(manual[0].name).toBe('legacy');
    expect(manual[0].enabled).toBe(false);
  });

  it('seeds a cron row per declared cron schedule, seed-if-absent', async () => {
    await seedTriggersFromDefinition(
      scope(),
      'team-alpha',
      def([
        { type: 'manual', name: 'manual' },
        { type: 'cron', name: 'nightly', schedule: '0 3 * * *' },
      ]),
    );

    const cron = (await triggerRepo.listByWorkflow('team-alpha', 'flow')).filter(
      (t) => t.type === 'cron',
    );
    expect(cron).toHaveLength(1);
    expect(cron[0]).toMatchObject({ name: 'nightly', enabled: true, config: { schedule: '0 3 * * *' } });
  });

  it('does not re-seed a cron row that already exists by name', async () => {
    const now = new Date().toISOString();
    await triggerRepo.create({
      type: 'cron',
      namespace: 'team-alpha',
      workflowName: 'flow',
      name: 'nightly',
      enabled: false,
      config: { schedule: '0 9 * * *' },
      lastTriggeredAt: now,
      createdAt: now,
      updatedAt: now,
    });

    await seedTriggersFromDefinition(
      scope(),
      'team-alpha',
      def([{ type: 'cron', name: 'nightly', schedule: '0 3 * * *' }]),
    );

    const nightly = (await triggerRepo.listByWorkflow('team-alpha', 'flow')).find(
      (t) => t.name === 'nightly',
    );
    // Untouched: still disabled with the original schedule.
    expect(nightly?.enabled).toBe(false);
    expect(nightly?.type === 'cron' && nightly.config.schedule).toBe('0 9 * * *');
  });

  it('seeds a webhook row per declared webhook trigger, seed-if-absent (Issue #931)', async () => {
    await seedTriggersFromDefinition(
      scope(),
      'team-alpha',
      def([
        { type: 'manual', name: 'manual' },
        { type: 'webhook', name: 'orders-hook', config: { method: 'POST', path: '/orders' } },
      ]),
    );

    const webhook = (await triggerRepo.listByWorkflow('team-alpha', 'flow')).filter(
      (t) => t.type === 'webhook',
    );
    expect(webhook).toHaveLength(1);
    expect(webhook[0]).toMatchObject({
      name: 'orders-hook',
      enabled: true,
      config: { method: 'POST', path: '/orders' },
    });
    expect(webhook[0].type === 'webhook' && webhook[0].lastTriggeredAt).toBeNull();
  });

  it('skips a webhook trigger whose config is malformed', async () => {
    await seedTriggersFromDefinition(
      scope(),
      'team-alpha',
      def([{ type: 'webhook', name: 'broken', config: { method: 'POST' } }]),
    );

    const webhook = (await triggerRepo.listByWorkflow('team-alpha', 'flow')).filter(
      (t) => t.type === 'webhook',
    );
    expect(webhook).toHaveLength(0);
  });

  it('does not re-seed a webhook row that already exists by name', async () => {
    const now = new Date().toISOString();
    await triggerRepo.create({
      type: 'webhook',
      namespace: 'team-alpha',
      workflowName: 'flow',
      name: 'orders-hook',
      enabled: false,
      config: { method: 'GET', path: '/old' },
      lastTriggeredAt: null,
      createdAt: now,
      updatedAt: now,
    });

    await seedTriggersFromDefinition(
      scope(),
      'team-alpha',
      def([{ type: 'webhook', name: 'orders-hook', config: { method: 'POST', path: '/orders' } }]),
    );

    const hook = (await triggerRepo.listByWorkflow('team-alpha', 'flow')).find(
      (t) => t.name === 'orders-hook',
    );
    // Untouched: still disabled with the original method+path.
    expect(hook?.enabled).toBe(false);
    expect(hook?.type === 'webhook' && hook.config.path).toBe('/old');
  });
});
