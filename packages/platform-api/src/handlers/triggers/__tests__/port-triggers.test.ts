import { describe, it, expect, beforeEach } from 'vitest';
import {
  InMemoryAuditRepository,
  InMemoryProcessInstanceRepository,
  InMemoryProcessRepository,
  InMemoryTriggerRepository,
  buildWorkflowDefinition,
  resetFactorySequence,
} from '@mediforce/platform-core/testing';
import { createTrigger, exportTriggers, importTriggers } from '../manage-triggers';
import { createTestScope, userCaller } from '../../../repositories/__tests__/create-test-scope';
import { NotFoundError, ValidationError } from '../../../errors';

/**
 * L3 round-trip for the portable trigger-config file (Issue #933): export from
 * one namespace, import into another, and assert the detachment guarantees —
 * webhook URLs re-derive for the target host, cron cursors anchor to `now`, and
 * the seed-if-absent conflict policy holds unless `replace` is set.
 */
describe('trigger export/import (portable config file, Issue #933)', () => {
  let processRepo: InMemoryProcessRepository;
  let auditRepo: InMemoryAuditRepository;
  let triggerRepo: InMemoryTriggerRepository;

  const SOURCE = 'team-alpha';
  const TARGET = 'team-beta';

  beforeEach(async () => {
    resetFactorySequence();
    processRepo = new InMemoryProcessRepository();
    const instanceRepo = new InMemoryProcessInstanceRepository();
    auditRepo = new InMemoryAuditRepository(instanceRepo);
    triggerRepo = new InMemoryTriggerRepository();
    // The same workflow name exists in both instances (as if the trigger-free
    // Definition was registered on each — Issue #932).
    await processRepo.saveWorkflowDefinition(
      buildWorkflowDefinition({ name: 'flow', version: 1, namespace: SOURCE }),
    );
    await processRepo.saveWorkflowDefinition(
      buildWorkflowDefinition({ name: 'flow', version: 1, namespace: TARGET }),
    );
  });

  function scopeFor(namespaces = [SOURCE, TARGET]) {
    return createTestScope({
      processRepo,
      auditRepo,
      triggerRepo,
      caller: userCaller('user-42', namespaces),
    });
  }

  async function seedSourceTriggers() {
    const scope = scopeFor();
    await createTrigger(
      { namespace: SOURCE, definitionName: 'flow', triggerName: 'nightly', type: 'cron', schedule: '0 2 * * *', enabled: true },
      scope,
    );
    await createTrigger(
      { namespace: SOURCE, definitionName: 'flow', triggerName: 'intake', type: 'webhook', method: 'POST', path: '/intake', enabled: true },
      scope,
    );
    await createTrigger(
      { namespace: SOURCE, definitionName: 'flow', triggerName: 'manual', type: 'manual', enabled: true },
      scope,
    );
  }

  it('exports only portable config, excluding instance/runtime state', async () => {
    await seedSourceTriggers();
    const { triggers } = await exportTriggers({ namespace: SOURCE, definitionName: 'flow' }, scopeFor());

    expect(triggers).toEqual([
      { name: 'nightly', type: 'cron', enabled: true, schedule: '0 2 * * *' },
      { name: 'intake', type: 'webhook', enabled: true, method: 'POST', path: '/intake' },
      { name: 'manual', type: 'manual', enabled: true },
    ]);
    // No namespace, workflowName, lastTriggeredAt, createdAt, or callable URL.
    for (const entry of triggers) {
      expect(entry).not.toHaveProperty('namespace');
      expect(entry).not.toHaveProperty('lastTriggeredAt');
      expect(entry).not.toHaveProperty('createdAt');
    }
  });

  it('round-trips all three types into a second namespace', async () => {
    await seedSourceTriggers();
    const exported = await exportTriggers({ namespace: SOURCE, definitionName: 'flow' }, scopeFor());

    const before = new Date().toISOString();
    const { results } = await importTriggers(
      { namespace: TARGET, definitionName: 'flow', triggers: exported.triggers, replace: false },
      scopeFor(),
    );

    expect(results.map((r) => r.outcome)).toEqual(['created', 'created', 'created']);

    const stored = await triggerRepo.listByWorkflow(TARGET, 'flow');
    expect(stored.map((t) => t.name).sort()).toEqual(['intake', 'manual', 'nightly']);
    // Every row landed in the target namespace.
    expect(stored.every((t) => t.namespace === TARGET)).toBe(true);

    // Webhook URL re-derived for the target host.
    const webhookResult = results.find((r) => r.type === 'webhook');
    expect(webhookResult?.webhookUrl).toBe('/api/triggers/webhook/team-beta/flow/intake');

    // Cron cursor anchored to import time so a materialized schedule never back-fires.
    const cron = stored.find((t) => t.type === 'cron');
    expect(cron?.type === 'cron' && cron.lastTriggeredAt).not.toBeNull();
    expect(cron?.type === 'cron' && cron.lastTriggeredAt! >= before).toBe(true);
  });

  it('skips existing trigger names by default (seed-if-absent)', async () => {
    await seedSourceTriggers();
    const exported = await exportTriggers({ namespace: SOURCE, definitionName: 'flow' }, scopeFor());
    await importTriggers(
      { namespace: TARGET, definitionName: 'flow', triggers: exported.triggers, replace: false },
      scopeFor(),
    );

    const second = await importTriggers(
      { namespace: TARGET, definitionName: 'flow', triggers: exported.triggers, replace: false },
      scopeFor(),
    );
    expect(second.results.map((r) => r.outcome)).toEqual(['skipped', 'skipped', 'skipped']);
  });

  it('overwrites existing triggers with --replace', async () => {
    await seedSourceTriggers();
    const exported = await exportTriggers({ namespace: SOURCE, definitionName: 'flow' }, scopeFor());
    await importTriggers(
      { namespace: TARGET, definitionName: 'flow', triggers: exported.triggers, replace: false },
      scopeFor(),
    );

    const changed = exported.triggers.map((t) =>
      t.type === 'cron' ? { ...t, schedule: '0 6 * * *' } : t,
    );
    const replaced = await importTriggers(
      { namespace: TARGET, definitionName: 'flow', triggers: changed, replace: true },
      scopeFor(),
    );
    expect(replaced.results.map((r) => r.outcome)).toEqual(['replaced', 'replaced', 'replaced']);

    const stored = await triggerRepo.listByWorkflow(TARGET, 'flow');
    const cron = stored.find((t) => t.type === 'cron');
    expect(cron?.type === 'cron' && cron.config.schedule).toBe('0 6 * * *');
    // No duplicate rows — replace dropped the old one first.
    expect(stored).toHaveLength(3);
  });

  it('reconciles a legacy-named manual entry against the target singleton (no abort)', async () => {
    // The target already has the auto-seeded `manual` singleton; the file
    // carries a manual named differently. createTrigger would 409 on a second
    // manual, so import must treat it as a singleton collision, not abort.
    await createTrigger(
      { namespace: TARGET, definitionName: 'flow', triggerName: 'manual', type: 'manual', enabled: true },
      scopeFor(),
    );
    const file = [
      { name: 'nightly', type: 'cron' as const, enabled: true, schedule: '0 2 * * *' },
      { name: 'start', type: 'manual' as const, enabled: true },
    ];

    const skipRun = await importTriggers(
      { namespace: TARGET, definitionName: 'flow', triggers: file, replace: false },
      scopeFor(),
    );
    expect(skipRun.results).toEqual([
      { name: 'nightly', type: 'cron', outcome: 'created', webhookUrl: null },
      { name: 'start', type: 'manual', outcome: 'skipped', webhookUrl: null },
    ]);
    // The cron entry still landed — no partial abort.
    const afterSkip = await triggerRepo.listByWorkflow(TARGET, 'flow');
    expect(afterSkip.filter((t) => t.type === 'manual')).toHaveLength(1);
    expect(afterSkip.some((t) => t.name === 'nightly')).toBe(true);

    // With replace, the existing singleton is dropped and recreated as 'start'.
    const replaceRun = await importTriggers(
      { namespace: TARGET, definitionName: 'flow', triggers: file, replace: true },
      scopeFor(),
    );
    expect(replaceRun.results.find((r) => r.type === 'manual')?.outcome).toBe('replaced');
    const afterReplace = await triggerRepo.listByWorkflow(TARGET, 'flow');
    const manuals = afterReplace.filter((t) => t.type === 'manual');
    expect(manuals).toHaveLength(1);
    expect(manuals[0].name).toBe('start');
  });

  it('rejects a file with a mis-aligned cron schedule before writing anything', async () => {
    const file = [
      { name: 'nightly', type: 'cron' as const, enabled: true, schedule: '0 2 * * *' },
      { name: 'bad', type: 'cron' as const, enabled: true, schedule: '5 2 * * *' },
    ];
    await expect(
      importTriggers({ namespace: TARGET, definitionName: 'flow', triggers: file, replace: false }, scopeFor()),
    ).rejects.toBeInstanceOf(ValidationError);
    // No partial write: the valid entry before the bad one was not created.
    const stored = await triggerRepo.listByWorkflow(TARGET, 'flow');
    expect(stored.some((t) => t.name === 'nightly')).toBe(false);
  });

  it('404s exporting a workflow that does not exist', async () => {
    await expect(
      exportTriggers({ namespace: SOURCE, definitionName: 'missing' }, scopeFor()),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});
