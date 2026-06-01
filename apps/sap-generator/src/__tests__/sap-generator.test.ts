import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseWorkflowDefinitionForCreation } from '@mediforce/platform-core';

const repoRoot = resolve(__dirname, '../../../..');
const wdPath = resolve(__dirname, '../sap-generator.wd.json');

function rawDefinition(): Record<string, unknown> {
  return JSON.parse(readFileSync(wdPath, 'utf-8'));
}

function parsedDefinition() {
  const result = parseWorkflowDefinitionForCreation(rawDefinition());
  if (!result.success) {
    throw new Error(`WorkflowDefinition failed validation: ${result.error}`);
  }
  return result.data;
}

describe('sap-generator workflow definition', () => {
  it('[DATA] parses as a valid WorkflowDefinition', () => {
    const result = parseWorkflowDefinitionForCreation(rawDefinition());

    expect(result.success).toBe(true);
  });

  it('[DATA] has the expected name and namespace', () => {
    const def = parsedDefinition();

    expect(def.name).toBe('sap-generator');
    expect(def.namespace).toBe('appsilon');
  });

  it('[DATA] has a manual trigger', () => {
    const def = parsedDefinition();

    expect(def.triggers.some((t) => t.type === 'manual')).toBe(true);
  });

  it('[DATA] first step uploads the protocol via a file-upload UI', () => {
    const def = parsedDefinition();
    const firstStep = def.steps[0];

    expect(firstStep.id).toBe('upload-protocol');
    expect(firstStep.executor).toBe('human');
    expect(firstStep.ui?.component).toBe('file-upload');
    expect(firstStep.ui?.config).toBeDefined();
  });

  it('[DATA] generation pipeline runs as claude-code agent steps', () => {
    const def = parsedDefinition();

    for (const id of ['extract-study-design', 'draft-sap', 'build-traceability']) {
      const step = def.steps.find((s) => s.id === id);
      expect(step, `step "${id}" exists`).toBeDefined();
      expect(step?.executor).toBe('agent');
      expect(step?.plugin).toBe('claude-code-agent');
      expect(step?.agent?.skill).toBe(id);
    }
  });

  it('[DATA] ends with a terminal step', () => {
    const def = parsedDefinition();
    const lastStep = def.steps[def.steps.length - 1];

    expect(lastStep.type).toBe('terminal');
  });

  it('[DATA] every transition references real step ids', () => {
    const def = parsedDefinition();
    const stepIds = new Set(def.steps.map((s) => s.id));

    for (const t of def.transitions) {
      expect(stepIds.has(t.from), `transition.from "${t.from}" is a real step`).toBe(true);
      expect(stepIds.has(t.to), `transition.to "${t.to}" is a real step`).toBe(true);
    }
  });

  it('[DATA] every non-terminal step has an outgoing route (transition or verdict)', () => {
    const def = parsedDefinition();

    for (const step of def.steps) {
      if (step.type === 'terminal') continue;
      const hasTransition = def.transitions.some((t) => t.from === step.id);
      const hasVerdict = step.verdicts !== undefined && Object.keys(step.verdicts).length > 0;
      expect(
        hasTransition || hasVerdict,
        `step "${step.id}" should route onward via a transition or a verdict`,
      ).toBe(true);
    }
  });

  it('[DATA] the human review loops back to draft-sap on revise and forward on approve', () => {
    const def = parsedDefinition();
    const review = def.steps.find((s) => s.id === 'review-sap');

    expect(review?.executor).toBe('human');
    expect(review?.type).toBe('review');
    expect(review?.verdicts?.revise?.target).toBe('draft-sap');
    expect(review?.verdicts?.approve?.target).toBe('finalize');
  });

  it('[DATA] every agent skill resolves to a SKILL.md on disk', () => {
    const def = parsedDefinition();

    for (const step of def.steps) {
      if (step.executor !== 'agent' || !step.agent?.skill) continue;
      const { skill, skillsDir } = step.agent;
      expect(skillsDir, `step "${step.id}" declares a skillsDir`).toBeDefined();
      const skillPath = resolve(repoRoot, skillsDir as string, skill, 'SKILL.md');
      expect(existsSync(skillPath), `${skillPath} exists`).toBe(true);
    }
  });
});
