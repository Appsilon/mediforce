import { describe, expect, it, vi } from 'vitest';
import { createSpawnActionHandler, type SpawnActionOutput } from '../spawn';
import type { ActionContext, ActionOutput } from '../../types';

const asSpawn = (o: ActionOutput) => o as unknown as SpawnActionOutput;

function makeTrigger(results?: Map<string, { instanceId: string }>) {
  return {
    fireWorkflow: vi.fn().mockImplementation((ctx: { definitionName: string }) => {
      const preset = results?.get(ctx.definitionName);
      if (preset) return Promise.resolve(preset);
      return Promise.resolve({ instanceId: `inst-${ctx.definitionName}`, status: 'created' });
    }),
  };
}

function makeProcessRepo(
  latestVersions?: Record<string, number>,
  // Child `triggerInput` contracts by workflow name. A name with no entry
  // resolves to a definition with no contract, so payloads pass freely — the
  // default for tests that aren't about validation.
  contracts?: Record<
    string,
    Array<{ name: string; type?: string; required?: boolean; default?: unknown }>
  >,
) {
  return {
    getLatestWorkflowVersion: vi.fn().mockImplementation((_ns: string, name: string) => {
      return Promise.resolve(latestVersions?.[name] ?? 3);
    }),
    getWorkflowDefinition: vi.fn().mockImplementation((_ns: string, name: string) => {
      return Promise.resolve({ name, triggerInput: contracts?.[name] ?? [] });
    }),
  };
}

const baseCtx: ActionContext = {
  stepId: 'spawn-step',
  processInstanceId: 'parent-inst-1',
  namespace: 'test-ns',
  definitionName: 'parent-workflow',
  sources: {
    triggerPayload: { focusArea: 'security' },
    steps: {
      prepare: {
        teamMembers: [
          { userId: 'alice', email: 'alice@test.com' },
          { userId: 'bob', email: 'bob@test.com' },
        ],
      },
    },
    variables: {
      prepare: {
        teamMembers: [
          { userId: 'alice', email: 'alice@test.com' },
          { userId: 'bob', email: 'bob@test.com' },
        ],
      },
    },
    secrets: {},
  },
};

describe('createSpawnActionHandler', () => {
  it('spawns single target', async () => {
    const trigger = makeTrigger();
    // The child declares the key this spawn sends — a spawn firing validates
    // against the child's contract like any other firing (ADR-0012).
    const repo = makeProcessRepo(undefined, { 'child-wf': [{ name: 'key', type: 'string' }] });
    const handler = createSpawnActionHandler(trigger as never, repo as never);

    const result = asSpawn(await handler(
      { targets: { definitionName: 'child-wf', payload: { key: 'val' } }, continueOnSpawnError: true },
      baseCtx,
    ));

    expect(trigger.fireWorkflow).toHaveBeenCalledTimes(1);
    expect(trigger.fireWorkflow).toHaveBeenCalledWith(
      expect.objectContaining({
        namespace: 'test-ns',
        definitionName: 'child-wf',
        definitionVersion: 3,
        triggerName: 'manual',
        triggeredBy: 'spawn',
        payload: { key: 'val' },
        parentInstanceId: 'parent-inst-1',
        parentDefinitionName: 'parent-workflow',
      }),
    );
    expect(result.spawnedCount).toBe(1);
    expect(result.errorCount).toBe(0);
    expect(result.spawned[0].instanceId).toBe('inst-child-wf');
  });

  it('spawns static multi-target array', async () => {
    const trigger = makeTrigger();
    const repo = makeProcessRepo();
    const handler = createSpawnActionHandler(trigger as never, repo as never);

    const result = asSpawn(await handler(
      {
        targets: [
          { definitionName: 'legal-review' },
          { definitionName: 'medical-review' },
        ],
        continueOnSpawnError: true,
      },
      baseCtx,
    ));

    expect(trigger.fireWorkflow).toHaveBeenCalledTimes(2);
    expect(result.spawnedCount).toBe(2);
    expect(result.spawned[0].definitionName).toBe('legal-review');
    expect(result.spawned[1].definitionName).toBe('medical-review');
  });

  it('spawns with forEach — one child per array element', async () => {
    const trigger = makeTrigger();
    const repo = makeProcessRepo(undefined, {
      'gather-perspective': [
        { name: 'userId', type: 'string' },
        { name: 'email', type: 'string' },
      ],
    });
    const handler = createSpawnActionHandler(trigger as never, repo as never);

    const result = asSpawn(await handler(
      {
        targets: {
          definitionName: 'gather-perspective',
          payload: { userId: '${item.userId}', email: '${item.email}' },
        },
        forEach: '${steps.prepare.teamMembers}',
        continueOnSpawnError: true,
      },
      baseCtx,
    ));

    expect(trigger.fireWorkflow).toHaveBeenCalledTimes(2);
    expect(trigger.fireWorkflow).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: { userId: 'alice', email: 'alice@test.com' },
      }),
    );
    expect(trigger.fireWorkflow).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: { userId: 'bob', email: 'bob@test.com' },
      }),
    );
    expect(result.spawnedCount).toBe(2);
    expect(result.spawned[0].itemIndex).toBe(0);
    expect(result.spawned[1].itemIndex).toBe(1);
  });

  it('returns empty output for forEach with empty array', async () => {
    const trigger = makeTrigger();
    const repo = makeProcessRepo();
    const handler = createSpawnActionHandler(trigger as never, repo as never);

    const ctx = {
      ...baseCtx,
      sources: {
        ...baseCtx.sources,
        steps: { prepare: { teamMembers: [] } },
        variables: { prepare: { teamMembers: [] } },
      },
    };

    const result = asSpawn(await handler(
      {
        targets: { definitionName: 'gather-perspective' },
        forEach: '${steps.prepare.teamMembers}',
        continueOnSpawnError: true,
      },
      ctx,
    ));

    expect(trigger.fireWorkflow).not.toHaveBeenCalled();
    expect(result.spawnedCount).toBe(0);
    expect(result.errorCount).toBe(0);
  });

  it('throws when forEach resolves to non-array', async () => {
    const trigger = makeTrigger();
    const repo = makeProcessRepo();
    const handler = createSpawnActionHandler(trigger as never, repo as never);

    await expect(
      handler(
        {
          targets: { definitionName: 'wf' },
          forEach: '${triggerPayload.focusArea}',
          continueOnSpawnError: true,
        },
        baseCtx,
      ),
    ).rejects.toThrow('forEach resolved to string, expected array');
  });

  it('accumulates errors when continueOnSpawnError is true', async () => {
    const trigger = {
      fireWorkflow: vi.fn()
        .mockResolvedValueOnce({ instanceId: 'inst-1', status: 'created' })
        .mockRejectedValueOnce(new Error('WD not found')),
    };
    const repo = makeProcessRepo();
    const handler = createSpawnActionHandler(trigger as never, repo as never);

    const result = asSpawn(await handler(
      {
        targets: [
          { definitionName: 'ok-wf' },
          { definitionName: 'bad-wf' },
        ],
        continueOnSpawnError: true,
      },
      baseCtx,
    ));

    expect(result.spawnedCount).toBe(1);
    expect(result.errorCount).toBe(1);
    expect(result.errors[0].definitionName).toBe('bad-wf');
    expect(result.errors[0].message).toBe('WD not found');
  });

  it('throws on first error when continueOnSpawnError is false', async () => {
    const trigger = {
      fireWorkflow: vi.fn().mockRejectedValue(new Error('boom')),
    };
    const repo = makeProcessRepo();
    const handler = createSpawnActionHandler(trigger as never, repo as never);

    await expect(
      handler(
        {
          targets: { definitionName: 'wf' },
          continueOnSpawnError: false,
        },
        baseCtx,
      ),
    ).rejects.toThrow('boom');
  });

  it('uses explicit definitionVersion when provided', async () => {
    const trigger = makeTrigger();
    const repo = makeProcessRepo();
    const handler = createSpawnActionHandler(trigger as never, repo as never);

    await handler(
      {
        targets: { definitionName: 'child', definitionVersion: 7 },
        continueOnSpawnError: true,
      },
      baseCtx,
    );

    expect(repo.getLatestWorkflowVersion).not.toHaveBeenCalled();
    expect(trigger.fireWorkflow).toHaveBeenCalledWith(
      expect.objectContaining({ definitionVersion: 7 }),
    );
  });

  it('forwards custom triggerName to fireWorkflow', async () => {
    const trigger = makeTrigger();
    const repo = makeProcessRepo();
    const handler = createSpawnActionHandler(trigger as never, repo as never);

    await handler(
      {
        targets: { definitionName: 'child', triggerName: 'api' },
        continueOnSpawnError: true,
      },
      baseCtx,
    );

    expect(trigger.fireWorkflow).toHaveBeenCalledWith(
      expect.objectContaining({ triggerName: 'api' }),
    );
  });

  it('rejects when fan-out exceeds 50 spawns', async () => {
    const trigger = makeTrigger();
    const repo = makeProcessRepo();
    const handler = createSpawnActionHandler(trigger as never, repo as never);

    const bigArray = Array.from({ length: 51 }, (_, i) => ({ id: i }));
    const ctx = {
      ...baseCtx,
      sources: {
        ...baseCtx.sources,
        steps: { data: { items: bigArray } },
        variables: { data: { items: bigArray } },
      },
    };

    await expect(
      handler(
        {
          targets: { definitionName: 'wf' },
          forEach: '${steps.data.items}',
          continueOnSpawnError: true,
        },
        ctx,
      ),
    ).rejects.toThrow('spawn fan-out exceeds maximum of 50');
  });

  it('errors when definition not found (version 0)', async () => {
    const trigger = makeTrigger();
    const repo = makeProcessRepo({ 'missing-wf': 0 });
    const handler = createSpawnActionHandler(trigger as never, repo as never);

    const result = asSpawn(await handler(
      {
        targets: { definitionName: 'missing-wf' },
        continueOnSpawnError: true,
      },
      baseCtx,
    ));

    expect(result.errorCount).toBe(1);
    expect(result.errors[0].message).toContain('not found');
  });

  // ADR-0012: a spawned child's `triggerInput` is its total input contract, so a
  // spawn firing is validated exactly like a manual or API start. Without this a
  // typo'd payload key interpolated to '' inside the child while the identical
  // payload sent to POST /api/runs returned 400 — the same workflow behaving
  // two ways depending on who started it.
  describe('child triggerInput contract', () => {
    const contract = { 'child-wf': [{ name: 'email', type: 'string', required: true }] };

    it('spawns when the payload satisfies the child contract', async () => {
      const trigger = makeTrigger();
      const repo = makeProcessRepo(undefined, contract);
      const handler = createSpawnActionHandler(trigger as never, repo as never);

      const result = asSpawn(await handler(
        {
          targets: { definitionName: 'child-wf', payload: { email: 'alice@test.com' } },
          continueOnSpawnError: true,
        },
        baseCtx,
      ));

      expect(result.spawnedCount).toBe(1);
      expect(result.errorCount).toBe(0);
    });

    it('fires the child with its own contract default for an omitted field', async () => {
      // The default is the child's, not the parent's: a spawn that never
      // mentions `locale` still starts the child on the value its own contract
      // declares, exactly as a manual start of that child would.
      const trigger = makeTrigger();
      const repo = makeProcessRepo(undefined, {
        'child-wf': [
          { name: 'email', type: 'string', required: true },
          { name: 'locale', type: 'string', default: 'en-US' },
        ],
      });
      const handler = createSpawnActionHandler(trigger as never, repo as never);

      await handler(
        {
          targets: { definitionName: 'child-wf', payload: { email: 'alice@test.com' } },
          continueOnSpawnError: true,
        },
        baseCtx,
      );

      expect(trigger.fireWorkflow).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: { email: 'alice@test.com', locale: 'en-US' },
        }),
      );
    });

    it('reports a mistyped payload key as a spawn error instead of firing', async () => {
      const trigger = makeTrigger();
      const repo = makeProcessRepo(undefined, contract);
      const handler = createSpawnActionHandler(trigger as never, repo as never);

      const result = asSpawn(await handler(
        {
          targets: { definitionName: 'child-wf', payload: { emial: 'alice@test.com' } },
          continueOnSpawnError: true,
        },
        baseCtx,
      ));

      expect(trigger.fireWorkflow).not.toHaveBeenCalled();
      expect(result.spawnedCount).toBe(0);
      expect(result.errors[0]!.message).toContain('emial');
      expect(result.errors[0]!.message).toContain('email');
    });

    it('throws when continueOnSpawnError is false', async () => {
      const trigger = makeTrigger();
      const repo = makeProcessRepo(undefined, contract);
      const handler = createSpawnActionHandler(trigger as never, repo as never);

      await expect(
        handler(
          {
            targets: { definitionName: 'child-wf', payload: {} },
            continueOnSpawnError: false,
          },
          baseCtx,
        ),
      ).rejects.toThrow(/email/);
    });

    it('rejects a non-empty payload when the child declares no contract', async () => {
      const trigger = makeTrigger();
      const repo = makeProcessRepo();
      const handler = createSpawnActionHandler(trigger as never, repo as never);

      const result = asSpawn(await handler(
        {
          targets: { definitionName: 'child-wf', payload: { stray: 1 } },
          continueOnSpawnError: true,
        },
        baseCtx,
      ));

      expect(trigger.fireWorkflow).not.toHaveBeenCalled();
      expect(result.errors[0]!.message).toContain('stray');
    });
  });
});
