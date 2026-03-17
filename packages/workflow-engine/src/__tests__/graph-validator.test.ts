import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseProcessDefinition } from '@mediforce/platform-core';
import type { ProcessDefinition } from '@mediforce/platform-core';
import { validateStepGraph } from '../index.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const fixturesDir = resolve(__dirname, 'fixtures');

function loadFixture(name: string): ProcessDefinition {
  const yaml = readFileSync(resolve(fixturesDir, name), 'utf-8');
  const result = parseProcessDefinition(yaml);
  if (!result.success) {
    throw new Error(`Failed to parse fixture ${name}: ${result.error}`);
  }
  return result.data;
}

describe('validateStepGraph', () => {
  it('valid linear process passes validation', () => {
    const definition = loadFixture('linear-process.yaml');
    const result = validateStepGraph(definition);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('valid branching process passes validation', () => {
    const definition = loadFixture('branching-process.yaml');
    const result = validateStepGraph(definition);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('valid review process with intentional cycle passes validation', () => {
    const definition = loadFixture('review-process.yaml');
    const result = validateStepGraph(definition);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('rejects process with transition to nonexistent step', () => {
    const definition = loadFixture('linear-process.yaml');
    const modified: ProcessDefinition = {
      ...definition,
      transitions: [
        ...definition.transitions,
        { from: 'start', to: 'ghost-step' },
      ],
    };
    const result = validateStepGraph(modified);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('ghost-step'))).toBe(true);
  });

  it('rejects process with transition from nonexistent step', () => {
    const definition = loadFixture('linear-process.yaml');
    const modified: ProcessDefinition = {
      ...definition,
      transitions: [
        ...definition.transitions,
        { from: 'phantom', to: 'done' },
      ],
    };
    const result = validateStepGraph(modified);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('phantom'))).toBe(true);
  });

  it('rejects process with no terminal step', () => {
    const definition: ProcessDefinition = {
      name: 'no-terminal',
      version: '1.0',
      steps: [
        { id: 'a', name: 'A', type: 'creation' },
        { id: 'b', name: 'B', type: 'creation' },
      ],
      transitions: [{ from: 'a', to: 'b' }],
      triggers: [{ type: 'manual', name: 'Start' }],
    };
    const result = validateStepGraph(definition);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.toLowerCase().includes('terminal'))).toBe(true);
  });

  it('rejects non-terminal step with no outgoing transitions or verdicts', () => {
    const definition: ProcessDefinition = {
      name: 'dead-end',
      version: '1.0',
      steps: [
        { id: 'start', name: 'Start', type: 'creation' },
        { id: 'stuck', name: 'Stuck', type: 'creation' },
        { id: 'done', name: 'Done', type: 'terminal' },
      ],
      transitions: [{ from: 'start', to: 'stuck' }],
      triggers: [{ type: 'manual', name: 'Start' }],
    };
    const result = validateStepGraph(definition);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('stuck'))).toBe(true);
  });

  it('rejects verdict targeting nonexistent step', () => {
    const definition: ProcessDefinition = {
      name: 'bad-verdict',
      version: '1.0',
      steps: [
        { id: 'start', name: 'Start', type: 'creation' },
        {
          id: 'review',
          name: 'Review',
          type: 'review',
          verdicts: {
            approve: { target: 'nonexistent' },
            reject: { target: 'done' },
          },
        },
        { id: 'done', name: 'Done', type: 'terminal' },
      ],
      transitions: [
        { from: 'start', to: 'review' },
        { from: 'review', to: 'nonexistent' },
        { from: 'review', to: 'done' },
      ],
      triggers: [{ type: 'manual', name: 'Start' }],
    };
    const result = validateStepGraph(definition);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('nonexistent'))).toBe(true);
  });

  it('detects unreachable steps', () => {
    const definition: ProcessDefinition = {
      name: 'unreachable',
      version: '1.0',
      steps: [
        { id: 'start', name: 'Start', type: 'creation' },
        { id: 'island', name: 'Island', type: 'creation' },
        { id: 'done', name: 'Done', type: 'terminal' },
      ],
      transitions: [
        { from: 'start', to: 'done' },
        { from: 'island', to: 'done' },
      ],
      triggers: [{ type: 'manual', name: 'Start' }],
    };
    const result = validateStepGraph(definition);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('island'))).toBe(true);
  });

  it('selection on review step is valid', () => {
    const definition: ProcessDefinition = {
      name: 'selection-review',
      version: '1.0',
      steps: [
        { id: 'start', name: 'Start', type: 'creation' },
        {
          id: 'review',
          name: 'Review',
          type: 'review',
          selection: 3,
          verdicts: {
            approve: { target: 'done' },
            reject: { target: 'done' },
          },
        },
        { id: 'done', name: 'Done', type: 'terminal' },
      ],
      transitions: [
        { from: 'start', to: 'review' },
        { from: 'review', to: 'done' },
      ],
      triggers: [{ type: 'manual', name: 'Start' }],
    };
    const result = validateStepGraph(definition);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('selection with min/max on review step is valid', () => {
    const definition: ProcessDefinition = {
      name: 'selection-range-review',
      version: '1.0',
      steps: [
        { id: 'start', name: 'Start', type: 'creation' },
        {
          id: 'review',
          name: 'Review',
          type: 'review',
          selection: { min: 2, max: 5 },
          verdicts: {
            approve: { target: 'done' },
            reject: { target: 'done' },
          },
        },
        { id: 'done', name: 'Done', type: 'terminal' },
      ],
      transitions: [
        { from: 'start', to: 'review' },
        { from: 'review', to: 'done' },
      ],
      triggers: [{ type: 'manual', name: 'Start' }],
    };
    const result = validateStepGraph(definition);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('selection on non-review step is invalid', () => {
    const definition: ProcessDefinition = {
      name: 'selection-wrong-type',
      version: '1.0',
      steps: [
        { id: 'start', name: 'Start', type: 'creation', selection: 2 },
        { id: 'done', name: 'Done', type: 'terminal' },
      ],
      transitions: [{ from: 'start', to: 'done' }],
      triggers: [{ type: 'manual', name: 'Start' }],
    };
    const result = validateStepGraph(definition);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('selection') && e.includes('start'))).toBe(true);
  });

  it('selection with min > max is invalid', () => {
    const definition: ProcessDefinition = {
      name: 'selection-bad-range',
      version: '1.0',
      steps: [
        { id: 'start', name: 'Start', type: 'creation' },
        {
          id: 'review',
          name: 'Review',
          type: 'review',
          selection: { min: 5, max: 2 },
          verdicts: {
            approve: { target: 'done' },
            reject: { target: 'done' },
          },
        },
        { id: 'done', name: 'Done', type: 'terminal' },
      ],
      transitions: [
        { from: 'start', to: 'review' },
        { from: 'review', to: 'done' },
      ],
      triggers: [{ type: 'manual', name: 'Start' }],
    };
    const result = validateStepGraph(definition);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('min') && e.includes('max'))).toBe(true);
  });

  it('returns multiple errors when multiple issues exist', () => {
    const definition: ProcessDefinition = {
      name: 'multi-error',
      version: '1.0',
      steps: [
        { id: 'start', name: 'Start', type: 'creation' },
        { id: 'island', name: 'Island', type: 'creation' },
        { id: 'done', name: 'Done', type: 'terminal' },
      ],
      transitions: [
        { from: 'start', to: 'done' },
        { from: 'ghost', to: 'done' },
        { from: 'island', to: 'done' },
      ],
      triggers: [{ type: 'manual', name: 'Start' }],
    };
    const result = validateStepGraph(definition);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThanOrEqual(2);
  });
});
