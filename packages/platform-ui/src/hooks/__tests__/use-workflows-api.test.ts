import { describe, it, expect } from 'vitest';
import { mapApiToDefinitionGroups, type ApiDefinitionItem } from '../use-workflows-api';

describe('mapApiToDefinitionGroups', () => {
  it('maps API response to DefinitionGroup shape', () => {
    const items: ApiDefinitionItem[] = [{
      name: 'test-workflow',
      namespace: 'acme',
      latestVersion: 2,
      defaultVersion: 1,
      definition: {
        name: 'test-workflow',
        version: 2,
        steps: [
          { id: 'start', type: 'start' },
          { id: 'process', type: 'agent' },
          { id: 'end', type: 'terminal' },
        ],
        triggers: [{ type: 'manual', name: 'default' }],
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
      versions: [{
        version: '2',
        stepCount: 3,
        triggerCount: 1,
        title: 'Test Workflow',
        description: 'A test',
      }],
      stepCount: 3,
      hasManualTrigger: true,
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
          triggers: [],
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
          triggers: [],
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
        triggers: [{ type: 'cron', name: 'nightly' }],
        namespace: 'ns',
      },
    }];

    const result = mapApiToDefinitionGroups(items);
    expect(result[0].hasManualTrigger).toBe(false);
  });
});
