import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { workflowDesignerOutputSchema } from '../src/output-schema';

/**
 * Write the derived `cowork.outputSchema` into the design step of every
 * workflow-designer definition. Run after changing the WorkflowDefinition Zod
 * schema so the committed `.wd.json` files stay in sync:
 *
 *   pnpm --filter @mediforce/workflow-designer sync-schema
 *
 * `output-schema.test.ts` fails until this has been run.
 */
const DEFINITION_FILES = [
  'workflow-designer.wd.json',
  'voice-workflow-designer.wd.json',
];

const srcDir = resolve(import.meta.dirname, '..', 'src');

for (const file of DEFINITION_FILES) {
  const path = resolve(srcDir, file);
  const definition = JSON.parse(readFileSync(path, 'utf8')) as {
    steps: Array<{ id: string; cowork?: { outputSchema?: unknown } }>;
  };

  const designStep = definition.steps.find((step) => step.id === 'design');
  if (!designStep?.cowork) {
    throw new Error(`${file}: no 'design' step with a cowork config`);
  }

  designStep.cowork.outputSchema = workflowDesignerOutputSchema;
  writeFileSync(path, `${JSON.stringify(definition, null, 2)}\n`);
  console.log(`synced ${file}`);
}
