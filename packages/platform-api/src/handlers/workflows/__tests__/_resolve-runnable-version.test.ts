import { describe, it, expect, beforeEach } from 'vitest';
import {
  InMemoryAuditRepository,
  InMemoryProcessInstanceRepository,
  InMemoryProcessRepository,
  buildWorkflowDefinition,
  resetFactorySequence,
} from '@mediforce/platform-core/testing';
import { resolveRunnableVersion } from '../_resolve-runnable-version';
import { createTestScope, userCaller } from '../../../repositories/__tests__/create-test-scope';

/**
 * Shared by the cron heartbeat ("which version will this tick fire?") and cron
 * trigger create/update ("which contract must this static payload satisfy?").
 * The two stages of ADR-0012's payload check are only comparable because both
 * resolve through here.
 */
describe('resolveRunnableVersion', () => {
  let processRepo: InMemoryProcessRepository;
  let auditRepo: InMemoryAuditRepository;

  beforeEach(() => {
    resetFactorySequence();
    processRepo = new InMemoryProcessRepository();
    auditRepo = new InMemoryAuditRepository(new InMemoryProcessInstanceRepository());
  });

  function buildScope() {
    return createTestScope({
      processRepo,
      auditRepo,
      caller: userCaller('user-42', ['team-alpha']),
    });
  }

  async function save(version: number, extra: Record<string, unknown> = {}): Promise<void> {
    await processRepo.saveWorkflowDefinition(
      buildWorkflowDefinition({ name: 'flow', namespace: 'team-alpha', version, ...extra }),
    );
  }

  it('resolves the newest live version when no default is set', async () => {
    await save(1);
    await save(2);

    const result = await resolveRunnableVersion(buildScope(), 'team-alpha', 'flow');
    expect(result.ok === true && result.def.version).toBe(2);
  });

  it('prefers the default version over the newest', async () => {
    await save(1);
    await save(2);
    await processRepo.setDefaultWorkflowVersion('team-alpha', 'flow', 1);

    const result = await resolveRunnableVersion(buildScope(), 'team-alpha', 'flow');
    expect(result.ok === true && result.def.version).toBe(1);
  });

  it('skips an archived head and falls back to the newest live version', async () => {
    // Both the default pointer and getLatestVersion include archived versions,
    // so selecting from them directly would strand a workflow whose head is
    // archived even though an earlier version is still runnable.
    await save(1);
    await save(2, { archived: true });

    const result = await resolveRunnableVersion(buildScope(), 'team-alpha', 'flow');
    expect(result.ok === true && result.def.version).toBe(1);
  });

  it('reports no live version when every version is archived', async () => {
    await save(1, { archived: true });

    const result = await resolveRunnableVersion(buildScope(), 'team-alpha', 'flow');
    expect(result).toEqual({ ok: false, reason: 'No live version' });
  });

  it('reports no resolvable version when the workflow was never registered', async () => {
    const result = await resolveRunnableVersion(buildScope(), 'team-alpha', 'never');
    expect(result).toEqual({ ok: false, reason: 'No resolvable version' });
  });

  it('reports a soft-deleted workflow so a stale trigger row never fires a ghost run', async () => {
    await save(1);
    await processRepo.setWorkflowDeleted('team-alpha', 'flow', true);

    const result = await resolveRunnableVersion(buildScope(), 'team-alpha', 'flow');
    expect(result).toEqual({ ok: false, reason: 'Workflow deleted' });
  });
});
