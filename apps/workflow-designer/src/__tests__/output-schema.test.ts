import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { workflowDesignerOutputSchema } from '../output-schema';

const appDir = resolve(import.meta.dirname, '../..');

const DEFINITION_FILES = [
  'workflow-designer.wd.json',
  'voice-workflow-designer.wd.json',
];

function loadDesignStep(file: string) {
  const definition = JSON.parse(
    readFileSync(resolve(appDir, 'src', file), 'utf8'),
  ) as { steps: Array<{ id: string; cowork?: { outputSchema?: unknown } }> };
  return definition.steps.find((step) => step.id === 'design');
}

describe('design step outputSchema stays in sync with the workflow schema', () => {
  for (const file of DEFINITION_FILES) {
    it(`${file} embeds the schema-derived outputSchema`, () => {
      const designStep = loadDesignStep(file);
      // Drift means someone changed the WorkflowDefinition schema without
      // running `pnpm --filter @mediforce/workflow-designer sync-schema`.
      expect(designStep?.cowork?.outputSchema).toEqual(workflowDesignerOutputSchema);
    });
  }
});
