import { describe, expect, it, beforeEach } from 'vitest';
import {
  InMemoryProcessInstanceRepository,
  InMemoryProcessRepository,
  buildProcessInstance,
  buildWorkflowDefinition,
} from '@mediforce/platform-core/testing';
import { listWorkflows } from '../list-workflows';
import { createTestScope, userCaller } from '../../../repositories/__tests__/create-test-scope';

describe('listWorkflows handler', () => {
  let processRepo: InMemoryProcessRepository;

  beforeEach(() => {
    processRepo = new InMemoryProcessRepository();
  });

  it('returns { definitions: [] } when nothing is registered', async () => {
    const scope = createTestScope({ processRepo });
    const result = await listWorkflows({ includeCompletedRuns: true }, scope);
    expect(result.definitions).toEqual([]);
  });

  it('groups versions by name and resolves the latest version', async () => {
    await processRepo.saveWorkflowDefinition(
      buildWorkflowDefinition({ name: 'flow-a', version: 1 }),
    );
    await processRepo.saveWorkflowDefinition(
      buildWorkflowDefinition({ name: 'flow-a', version: 2 }),
    );
    await processRepo.saveWorkflowDefinition(
      buildWorkflowDefinition({ name: 'flow-b', version: 1 }),
    );

    const scope = createTestScope({ processRepo });
    const result = await listWorkflows({ includeCompletedRuns: true }, scope);

    expect(result.definitions).toHaveLength(2);
    const flowA = result.definitions.find((d) => d.name === 'flow-a');
    expect(flowA?.latestVersion).toBe(2);
    expect(flowA?.definition?.version).toBe(2);
  });

  it('returns latest version per name (newest version wins)', async () => {
    await processRepo.saveWorkflowDefinition(
      buildWorkflowDefinition({ name: 'flow-a', version: 1 }),
    );
    await processRepo.saveWorkflowDefinition(
      buildWorkflowDefinition({ name: 'flow-a', version: 3 }),
    );
    await processRepo.saveWorkflowDefinition(
      buildWorkflowDefinition({ name: 'flow-a', version: 2 }),
    );

    const scope = createTestScope({ processRepo });
    const result = await listWorkflows({ includeCompletedRuns: true }, scope);

    expect(result.definitions).toHaveLength(1);
    expect(result.definitions[0]?.latestVersion).toBe(3);
    expect(result.definitions[0]?.definition?.version).toBe(3);
  });

  describe('visibility + namespace filtering for user callers', () => {
    beforeEach(async () => {
      await processRepo.saveWorkflowDefinition(
        buildWorkflowDefinition({
          name: 'alpha-private',
          version: 1,
          namespace: 'team-alpha',
          visibility: 'private',
        }),
      );
      await processRepo.saveWorkflowDefinition(
        buildWorkflowDefinition({
          name: 'beta-private',
          version: 1,
          namespace: 'team-beta',
          visibility: 'private',
        }),
      );
      await processRepo.saveWorkflowDefinition(
        buildWorkflowDefinition({
          name: 'beta-public',
          version: 1,
          namespace: 'team-beta',
          visibility: 'public',
        }),
      );
    });

    it('api-key callers see every group regardless of visibility', async () => {
      const scope = createTestScope({ processRepo });
      const result = await listWorkflows({ includeCompletedRuns: true }, scope);
      expect(result.definitions.map((d) => d.name).sort()).toEqual([
        'alpha-private',
        'beta-private',
        'beta-public',
      ]);
    });

    it('user callers see public + their-namespace workflows', async () => {
      const scope = createTestScope({
        processRepo,
        caller: userCaller('u-1', ['team-alpha']),
      });

      const result = await listWorkflows({ includeCompletedRuns: true }, scope);

      expect(result.definitions.map((d) => d.name).sort()).toEqual([
        'alpha-private',
        'beta-public',
      ]);
    });

    it('user callers without namespace overlap only see public workflows', async () => {
      const scope = createTestScope({
        processRepo,
        caller: userCaller('u-2', ['team-gamma']),
      });

      const result = await listWorkflows({ includeCompletedRuns: true }, scope);

      expect(result.definitions.map((d) => d.name)).toEqual(['beta-public']);
    });

    it('respects the optional namespace filter while honouring visibility', async () => {
      const scope = createTestScope({
        processRepo,
        caller: userCaller('u-1', ['team-alpha']),
      });

      const result = await listWorkflows(
        { namespace: 'team-beta', includeCompletedRuns: true },
        scope,
      );

      // team-alpha user can see team-beta's public workflow, scoped via filter.
      expect(result.definitions.map((d) => d.name)).toEqual(['beta-public']);
    });

    it('namespace filter applies for api-key callers too', async () => {
      const scope = createTestScope({ processRepo });
      const result = await listWorkflows(
        { namespace: 'team-alpha', includeCompletedRuns: true },
        scope,
      );

      expect(result.definitions.map((d) => d.name)).toEqual(['alpha-private']);
    });
  });

  describe('runSummary aggregate', () => {
    let instanceRepo: InMemoryProcessInstanceRepository;

    beforeEach(async () => {
      instanceRepo = new InMemoryProcessInstanceRepository();
      await processRepo.saveWorkflowDefinition(
        buildWorkflowDefinition({ name: 'flow-a', version: 1, namespace: 'team-alpha' }),
      );
    });

    const seedRun = (overrides: Parameters<typeof buildProcessInstance>[0]) =>
      instanceRepo.create(
        buildProcessInstance({ definitionName: 'flow-a', namespace: 'team-alpha', ...overrides }),
      );

    it('counts total + active and previews the 3 newest runs (includeCompletedRuns=true)', async () => {
      await seedRun({ status: 'running', createdAt: '2026-01-01T00:00:00.000Z' });
      await seedRun({ status: 'created', createdAt: '2026-01-02T00:00:00.000Z' });
      await seedRun({ status: 'paused', createdAt: '2026-01-03T00:00:00.000Z' });
      await seedRun({ status: 'completed', createdAt: '2026-01-04T00:00:00.000Z' });
      await seedRun({ status: 'failed', createdAt: '2026-01-05T00:00:00.000Z' });

      const scope = createTestScope({ processRepo, instanceRepo });
      const result = await listWorkflows({ includeCompletedRuns: true }, scope);

      const flowA = result.definitions.find((d) => d.name === 'flow-a');
      expect(flowA?.runSummary.total).toBe(5);
      expect(flowA?.runSummary.active).toBe(3);
      expect(flowA?.runSummary.latest).toHaveLength(3);
      // Newest-first by createdAt.
      expect(flowA?.runSummary.latest.map((r) => r.status)).toEqual([
        'failed',
        'completed',
        'paused',
      ]);
    });

    it('excludes terminal runs from total + latest when includeCompletedRuns=false', async () => {
      await seedRun({ status: 'running', createdAt: '2026-01-01T00:00:00.000Z' });
      await seedRun({ status: 'completed', createdAt: '2026-01-04T00:00:00.000Z' });
      await seedRun({ status: 'failed', createdAt: '2026-01-05T00:00:00.000Z' });

      const scope = createTestScope({ processRepo, instanceRepo });
      const result = await listWorkflows({ includeCompletedRuns: false }, scope);

      const flowA = result.definitions.find((d) => d.name === 'flow-a');
      // Only the non-terminal running run survives total + latest.
      expect(flowA?.runSummary.total).toBe(1);
      expect(flowA?.runSummary.latest.map((r) => r.status)).toEqual(['running']);
      // `active` is independent of the toggle.
      expect(flowA?.runSummary.active).toBe(1);
    });

    it('always excludes archived and soft-deleted runs', async () => {
      await seedRun({ status: 'running', createdAt: '2026-01-01T00:00:00.000Z' });
      await seedRun({ status: 'completed', archived: true, createdAt: '2026-01-02T00:00:00.000Z' });
      await seedRun({ status: 'completed', deleted: true, createdAt: '2026-01-03T00:00:00.000Z' });

      const scope = createTestScope({ processRepo, instanceRepo });
      const result = await listWorkflows({ includeCompletedRuns: true }, scope);

      const flowA = result.definitions.find((d) => d.name === 'flow-a');
      expect(flowA?.runSummary.total).toBe(1);
      expect(flowA?.runSummary.active).toBe(1);
      expect(flowA?.runSummary.latest.map((r) => r.status)).toEqual(['running']);
    });

    it('returns a zeroed summary for a workflow with no runs', async () => {
      const scope = createTestScope({ processRepo, instanceRepo });
      const result = await listWorkflows({ includeCompletedRuns: true }, scope);

      const flowA = result.definitions.find((d) => d.name === 'flow-a');
      expect(flowA?.runSummary).toEqual({ total: 0, active: 0, latest: [] });
    });
  });
});
