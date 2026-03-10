import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseProcessDefinition } from '@mediforce/platform-core';
import type { ProcessDefinition } from '@mediforce/platform-core';

const yamlPath = resolve(__dirname, '../process-definition.yaml');

function loadDefinition(): ProcessDefinition {
  const yaml = readFileSync(yamlPath, 'utf-8');
  const result = parseProcessDefinition(yaml);
  if (!result.success) throw new Error(result.error);
  return result.data;
}

describe('protocol-to-tfl process definition', () => {
  it('[DATA] parses as a valid ProcessDefinition', () => {
    const yaml = readFileSync(yamlPath, 'utf-8');
    const result = parseProcessDefinition(yaml);

    expect(result.success).toBe(true);
  });

  it('[DATA] has correct process name and version', () => {
    const def = loadDefinition();

    expect(def.name).toBe('protocol-to-tfl');
    expect(def.version).toBeDefined();
  });

  it('[DATA] has a manual trigger', () => {
    const def = loadDefinition();

    const manualTrigger = def.triggers.find((t) => t.type === 'manual');
    expect(manualTrigger).toBeDefined();
  });

  it('[DATA] first step is upload-documents with file-upload UI', () => {
    const def = loadDefinition();
    const firstStep = def.steps[0];

    expect(firstStep.id).toBe('upload-documents');
    expect(firstStep.type).toBe('creation');
    expect(firstStep.ui?.component).toBe('file-upload');
    expect(firstStep.ui?.config).toBeDefined();
  });

  it('[DATA] has extract-metadata step', () => {
    const def = loadDefinition();
    const step = def.steps.find((s) => s.id === 'extract-metadata');

    expect(step).toBeDefined();
    expect(step?.name).toBe('Extract Metadata');
  });

  it('[DATA] has review-metadata step of type review', () => {
    const def = loadDefinition();
    const step = def.steps.find((s) => s.id === 'review-metadata');

    expect(step).toBeDefined();
    expect(step?.type).toBe('review');
  });

  it('[DATA] ends with a terminal step', () => {
    const def = loadDefinition();
    const lastStep = def.steps[def.steps.length - 1];

    expect(lastStep.type).toBe('terminal');
  });

  it('[DATA] transitions form a connected path from first to last step', () => {
    const def = loadDefinition();
    const stepIds = def.steps.map((s) => s.id);

    // Every non-terminal step should have an outgoing transition
    const nonTerminal = stepIds.filter(
      (id) => def.steps.find((s) => s.id === id)?.type !== 'terminal',
    );
    for (const stepId of nonTerminal) {
      const hasOutgoing = def.transitions.some((t) => t.from === stepId);
      expect(hasOutgoing, `Step "${stepId}" should have an outgoing transition`).toBe(true);
    }

    // Every non-first step should have an incoming transition
    for (const stepId of stepIds.slice(1)) {
      const hasIncoming = def.transitions.some((t) => t.to === stepId);
      expect(hasIncoming, `Step "${stepId}" should have an incoming transition`).toBe(true);
    }
  });
});
