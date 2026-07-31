import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryProcessRepository } from '../../testing/in-memory-process-repository';
import { buildWorkflowDefinition, resetFactorySequence } from '../../testing/factories';
import {
  pickRunnableVersion,
  resolveRunnableVersion,
  toWorkflowVersionSource,
} from '../resolve-runnable-version';

/**
 * The selection rule on its own — no repository, no async. The browser runs this
 * over `WorkflowVersionSummary` rows so the Triggers panel labels its payload
 * editor with the same version the server will fire, instead of carrying a
 * second copy of the rule that drifts.
 */
describe('pickRunnableVersion', () => {
  it('picks the newest live version when no default is set', () => {
    const picked = pickRunnableVersion([{ version: 1 }, { version: 2 }], null);
    expect(picked?.version).toBe(2);
  });

  it('picks the newest live version regardless of input order', () => {
    // The browser hands over versions sorted newest-first; the repository hands
    // them over ascending. The rule must not depend on either.
    const picked = pickRunnableVersion([{ version: 3 }, { version: 1 }, { version: 2 }], null);
    expect(picked?.version).toBe(3);
  });

  it('prefers the default version over the newest', () => {
    const picked = pickRunnableVersion([{ version: 1 }, { version: 2 }], 1);
    expect(picked?.version).toBe(1);
  });

  it('skips an archived default and falls back to the newest live version', () => {
    const picked = pickRunnableVersion([{ version: 1, archived: true }, { version: 2 }], 1);
    expect(picked?.version).toBe(2);
  });

  it('skips an archived head', () => {
    const picked = pickRunnableVersion([{ version: 1 }, { version: 2, archived: true }], null);
    expect(picked?.version).toBe(1);
  });

  it('returns null when every version is archived', () => {
    expect(pickRunnableVersion([{ version: 1, archived: true }], null)).toBeNull();
  });

  it('returns null for an empty version list', () => {
    expect(pickRunnableVersion([], 1)).toBeNull();
  });

  it('accepts rows that carry no deleted flag at all', () => {
    // `WorkflowVersionSummary` has `version` + `archived` and nothing else — the
    // client must be able to run the rule over exactly what it already fetched.
    const summaries: Array<{ version: number; archived: boolean; stepCount: number }> = [
      { version: 2, archived: false, stepCount: 3 },
      { version: 1, archived: false, stepCount: 2 },
    ];
    expect(pickRunnableVersion(summaries, null)?.version).toBe(2);
  });

  it('returns the row the caller passed in, not a narrowed copy', () => {
    const picked = pickRunnableVersion([{ version: 1, title: 'Intake' }], null);
    expect(picked?.title).toBe('Intake');
  });
});

/**
 * The single version policy every unpinned firing goes through — manual/API
 * start, cron heartbeat ("which version will this tick fire?"), cron trigger
 * create/update ("which contract must this static payload satisfy?"), and spawn.
 * ADR-0012's two-stage cron payload check is only comparable because both stages
 * resolve here.
 */
describe('resolveRunnableVersion', () => {
  let processRepo: InMemoryProcessRepository;

  beforeEach(() => {
    resetFactorySequence();
    processRepo = new InMemoryProcessRepository();
  });

  function source() {
    return toWorkflowVersionSource(processRepo);
  }

  async function save(version: number, extra: Record<string, unknown> = {}): Promise<void> {
    await processRepo.saveWorkflowDefinition(
      buildWorkflowDefinition({ name: 'flow', namespace: 'team-alpha', version, ...extra }),
    );
  }

  it('resolves the newest live version when no default is set', async () => {
    await save(1);
    await save(2);

    const result = await resolveRunnableVersion(source(), 'team-alpha', 'flow');
    expect(result.ok === true && result.def.version).toBe(2);
  });

  it('prefers the default version over the newest', async () => {
    await save(1);
    await save(2);
    await processRepo.setDefaultWorkflowVersion('team-alpha', 'flow', 1);

    const result = await resolveRunnableVersion(source(), 'team-alpha', 'flow');
    expect(result.ok === true && result.def.version).toBe(1);
  });

  it('skips an archived head and falls back to the newest live version', async () => {
    // Both the default pointer and getLatestVersion include archived versions,
    // so selecting from them directly would strand a workflow whose head is
    // archived even though an earlier version is still runnable.
    await save(1);
    await save(2, { archived: true });

    const result = await resolveRunnableVersion(source(), 'team-alpha', 'flow');
    expect(result.ok === true && result.def.version).toBe(1);
  });

  it('skips an archived default version and falls back to the newest live version', async () => {
    await save(1, { archived: true });
    await save(2);
    await processRepo.setDefaultWorkflowVersion('team-alpha', 'flow', 1);

    const result = await resolveRunnableVersion(source(), 'team-alpha', 'flow');
    expect(result.ok === true && result.def.version).toBe(2);
  });

  it('reports no live version when every version is archived', async () => {
    await save(1, { archived: true });

    const result = await resolveRunnableVersion(source(), 'team-alpha', 'flow');
    expect(result).toEqual({ ok: false, reason: 'No live version' });
  });

  it('reports no resolvable version when the workflow was never registered', async () => {
    const result = await resolveRunnableVersion(source(), 'team-alpha', 'never');
    expect(result).toEqual({ ok: false, reason: 'No resolvable version' });
  });

  it('reports a soft-deleted workflow so a stale trigger row never fires a ghost run', async () => {
    await save(1);
    await processRepo.setWorkflowDeleted('team-alpha', 'flow', true);

    const result = await resolveRunnableVersion(source(), 'team-alpha', 'flow');
    expect(result).toEqual({ ok: false, reason: 'Workflow deleted' });
  });

  it('accepts a source whose method names already match, with no adapter', async () => {
    // `scope.workflowDefinitions` in platform-api is passed straight in — the
    // port is structural so attach-time and fire-time cannot drift apart.
    await save(1);

    const result = await resolveRunnableVersion(
      {
        isNameDeleted: (namespace, name) => processRepo.isWorkflowNameDeleted(namespace, name),
        listVersions: (namespace, name) => processRepo.listWorkflowVersions(namespace, name),
        getDefaultVersion: (namespace, name) =>
          processRepo.getDefaultWorkflowVersion(namespace, name),
      },
      'team-alpha',
      'flow',
    );
    expect(result.ok === true && result.def.version).toBe(1);
  });
});
