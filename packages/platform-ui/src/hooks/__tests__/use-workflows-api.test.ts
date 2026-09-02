import { describe, it, expect } from 'vitest';
import { mapApiToDefinitionGroups, type ApiDefinitionItem } from '../use-workflows-api';

describe('mapApiToDefinitionGroups', () => {
  it('maps API response to DefinitionGroup shape', () => {
    const items: ApiDefinitionItem[] = [{
      name: 'test-workflow',
      namespace: 'acme',
      latestVersion: 2,
      defaultVersion: 1,
      manualStartEnabled: true,
      definition: {
        name: 'test-workflow',
        version: 2,
        steps: [
          { id: 'start', type: 'start' },
          { id: 'process', type: 'agent' },
          { id: 'end', type: 'terminal' },
        ],
        title: 'Test Workflow',
        description: 'A test',
        namespace: 'acme',
        visibility: 'public',
        externalSkillsRepo: { url: 'https://github.com/example/repo' },
      },
    }];

    const result = mapApiToDefinitionGroups(items);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      name: 'test-workflow',
      title: 'Test Workflow',
      description: 'A test',
      latestVersion: '2',
      // Pinned to v1 while v2 is the newest — the card must name the version a
      // run actually starts from, not the newest one.
      effectiveVersion: '1',
      versions: [{
        version: '2',
        stepCount: 3,
        title: 'Test Workflow',
        description: 'A test',
      }],
      stepCount: 3,
      hasManualTrigger: true,
      // The public profile read carries no gate, and no gate means open.
      callerMayRun: true,
      externalSkillsRepo: { url: 'https://github.com/example/repo' },
      url: undefined,
      archived: undefined,
      namespace: 'acme',
      visibility: 'public',
      runSummary: { total: 0, active: 0, latest: [], stepsByVersion: {} },
    });
  });

  it('maps multiple items', () => {
    const items: ApiDefinitionItem[] = [
      {
        name: 'wf-a',
        namespace: 'ns-a',
        latestVersion: 1,
        defaultVersion: 1,
        definition: {
          name: 'wf-a',
          version: 1,
          steps: [],
          namespace: 'ns-a',
        },
      },
      {
        name: 'wf-b',
        namespace: 'ns-a',
        latestVersion: 1,
        defaultVersion: 1,
        definition: {
          name: 'wf-b',
          version: 1,
          steps: [],
          namespace: 'ns-a',
        },
      },
    ];

    const result = mapApiToDefinitionGroups(items);
    expect(result).toHaveLength(2);
  });

  it('skips items with null definition', () => {
    const items: ApiDefinitionItem[] = [{
      name: 'broken',
      namespace: 'ns',
      latestVersion: 1,
      defaultVersion: 1,
      definition: null,
    }];

    const result = mapApiToDefinitionGroups(items);
    expect(result).toHaveLength(0);
  });

  it('falls back to the latest version when no default is pinned', () => {
    const items: ApiDefinitionItem[] = [{
      name: 'unpinned',
      namespace: 'ns',
      latestVersion: 3,
      defaultVersion: null,
      definition: {
        name: 'unpinned',
        version: 3,
        steps: [],
        namespace: 'ns',
      },
    }];

    const result = mapApiToDefinitionGroups(items);
    expect(result[0].effectiveVersion).toBe('3');
  });

  it('detects no manual trigger', () => {
    const items: ApiDefinitionItem[] = [{
      name: 'cron-only',
      namespace: 'ns',
      latestVersion: 1,
      defaultVersion: 1,
      definition: {
        name: 'cron-only',
        version: 1,
        steps: [{ id: 's1', type: 'start' }],
        namespace: 'ns',
      },
    }];

    const result = mapApiToDefinitionGroups(items);
    expect(result[0].hasManualTrigger).toBe(false);
  });
});
