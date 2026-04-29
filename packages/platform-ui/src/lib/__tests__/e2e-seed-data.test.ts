import { describe, expect, it } from 'vitest';
import { WorkflowDefinitionSchema } from '@mediforce/platform-core';
import { buildSeedData } from '../../../e2e/helpers/seed-data';

describe('E2E seed workflow definitions', () => {
  it('all seeded workflow definitions parse as valid workflow definitions', () => {
    const seedData = buildSeedData('test-user-id');

    for (const [documentId, definition] of Object.entries(seedData.workflowDefinitions)) {
      const result = WorkflowDefinitionSchema.safeParse(definition);
      expect(result.success, documentId).toBe(true);
    }
  });

  it('keeps Supply Chain Review human-review as a plain human step', () => {
    const seedData = buildSeedData('test-user-id');
    const supplyChainReview = seedData.workflowDefinitions['Supply Chain Review:1'];
    const result = WorkflowDefinitionSchema.parse(supplyChainReview);

    const humanReview = result.steps.find((step) => step.id === 'human-review');
    expect(humanReview).toBeDefined();
    expect(humanReview?.type).toBe('creation');
    expect(humanReview?.executor).toBe('human');
  });
});
