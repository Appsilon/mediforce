#!/usr/bin/env node
/**
 * Pre-generates HTML diagram snippets for each workflow example.
 * Reads *.wd.json, calls renderWorkflowDiagram, writes *.diagram.html.
 *
 * Run: node docs/workflow-examples/build-diagrams.mjs
 */
import { readdirSync, readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Import the render function from platform-api
const { renderWorkflowDiagram } = await import(
  '../../packages/platform-api/src/handlers/renders/workflow-diagram.ts'
);

const files = readdirSync(__dirname).filter(f => f.endsWith('.wd.json')).sort();

for (const file of files) {
  const definition = JSON.parse(readFileSync(resolve(__dirname, file), 'utf8'));
  const html = renderWorkflowDiagram({ definition });
  const outFile = file.replace('.wd.json', '.diagram.html');
  writeFileSync(resolve(__dirname, outFile), html);
  console.log(`${file} → ${outFile}`);
}

console.log(`\nGenerated ${files.length} diagrams.`);
