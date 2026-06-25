#!/usr/bin/env node
/**
 * Pre-generates HTML diagram snippets for each workflow example.
 * Reads *.wd.json via shared loader, calls renderWorkflowDiagram, writes *.diagram.html.
 *
 * Run: node --import tsx docs/workflow-examples/build-diagrams.mjs
 */
import { writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { loadWorkflowExamples } from '../../packages/platform-core/src/workflow-examples.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '../..');

const { renderWorkflowDiagram } = await import(
  '../../packages/platform-api/src/handlers/renders/workflow-diagram.ts'
);

const { examples } = loadWorkflowExamples(repoRoot);

for (const { file, definition } of examples) {
  const html = renderWorkflowDiagram({ definition });
  const outFile = file.replace('.wd.json', '.diagram.html');
  writeFileSync(resolve(__dirname, outFile), html + '\n');
  console.log(`${file} → ${outFile}`);
}

console.log(`\nGenerated ${examples.length} diagrams.`);
