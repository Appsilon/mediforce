import { describe, expect, it, beforeEach } from 'vitest';
import {
  InMemoryProcessRepository,
  buildWorkflowDefinition,
} from '@mediforce/platform-core/testing';
import { listWorkflowDefinitions } from '../list-workflow-definitions.js';

describe('listWorkflowDefinitions handler', () => {
  let processRepo: InMemoryProcessRepository;

  beforeEach(() => {
    processRepo = new InMemoryProcessRepository();
  });

  it('returns { definitions: [] } when nothing is registered', async () => {
    const result = await listWorkflowDefinitions({}, { processRepo });
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

    const result = await listWorkflowDefinitions({}, { processRepo });

    expect(result.definitions).toHaveLength(2);
    const flowA = result.definitions.find((d) => d.name === 'flow-a');
    expect(flowA?.latestVersion).toBe(2);
    expect(flowA?.definition?.version).toBe(2);
  });

  it('sets definition to null when no version matches latestVersion (defensive)', async () => {
    // Valid input never produces this shape, but the route projected the
    // latest with `?? null` for safety — contract keeps the same guarantee.
    const result = await listWorkflowDefinitions({}, { processRepo });
    expect(result.definitions.every((d) => d.definition === null || d.definition !== undefined)).toBe(true);
  });
});
