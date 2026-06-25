import { readdirSync, readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

export interface WorkflowExample {
  file: string;
  name: string;
  title: string;
  description: string;
  definition: Record<string, unknown>;
}

export interface WorkflowAntiPattern {
  file: string;
  name: string;
  description: string;
  why: string;
  fix: string;
  expectedError: string;
  validatesAs?: string;
  definition: Record<string, unknown>;
}

export function loadWorkflowExamples(repoRoot: string): {
  examples: WorkflowExample[];
  antiPatterns: WorkflowAntiPattern[];
} {
  const examplesDir = resolve(repoRoot, 'docs/workflow-examples');
  const antiPatternsDir = resolve(examplesDir, 'anti-patterns');

  if (!existsSync(examplesDir)) {
    console.warn('[workflow-examples] Examples directory not found:', examplesDir);
    return { examples: [], antiPatterns: [] };
  }

  const examples = readdirSync(examplesDir)
    .filter(f => f.endsWith('.wd.json'))
    .sort()
    .map(f => {
      const def = JSON.parse(readFileSync(resolve(examplesDir, f), 'utf8'));
      return {
        file: f,
        name: def.name,
        title: def.title,
        description: def.description,
        definition: def,
      };
    });

  const antiPatterns = existsSync(antiPatternsDir)
    ? readdirSync(antiPatternsDir)
        .filter(f => f.endsWith('.json'))
        .sort()
        .map(f => {
          const raw = JSON.parse(readFileSync(resolve(antiPatternsDir, f), 'utf8'));
          return { file: f, ...raw };
        })
    : [];

  return { examples, antiPatterns };
}
