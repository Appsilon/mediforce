import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { WorkflowDefinitionSchema } from '@mediforce/platform-core';

describe('workflow-designer', () => {
  const appDir = resolve(import.meta.dirname, '../..');

  function loadDefinition() {
    const raw = JSON.parse(
      readFileSync(resolve(appDir, 'src/workflow-designer.wd.json'), 'utf8'),
    );
    return WorkflowDefinitionSchema.safeParse({ ...raw, version: 1 });
  }

  describe('workflow-designer.wd.json', () => {
    it('validates against WorkflowDefinitionSchema', () => {
      const result = loadDefinition();

      expect(result.success).toBe(true);
      if (!result.success) return;

      expect(result.data.name).toBe('workflow-designer');
      expect(result.data.steps).toHaveLength(7);
      expect(result.data.transitions).toHaveLength(7);
      expect(result.data.triggers).toHaveLength(1);
    });

    it('has exactly one terminal step', () => {
      const result = loadDefinition();
      expect(result.success).toBe(true);
      if (!result.success) return;

      const terminals = result.data.steps.filter(s => s.type === 'terminal');
      expect(terminals).toHaveLength(1);
      expect(terminals[0].id).toBe('done');
    });

    it('every non-terminal step has an executor', () => {
      const result = loadDefinition();
      expect(result.success).toBe(true);
      if (!result.success) return;

      const nonTerminal = result.data.steps.filter(s => s.type !== 'terminal');
      for (const step of nonTerminal) {
        expect(step.executor).toBeDefined();
        expect(['human', 'agent', 'script', 'cowork']).toContain(step.executor);
      }
    });

    it('has all transition targets referencing valid step IDs', () => {
      const result = loadDefinition();
      expect(result.success).toBe(true);
      if (!result.success) return;

      const stepIds = new Set(result.data.steps.map(s => s.id));
      for (const transition of result.data.transitions) {
        expect(stepIds.has(transition.from)).toBe(true);
        expect(stepIds.has(transition.to)).toBe(true);
      }
    });

    it('has review step verdicts pointing to valid step IDs', () => {
      const result = loadDefinition();
      expect(result.success).toBe(true);
      if (!result.success) return;

      const stepIds = new Set(result.data.steps.map(s => s.id));
      const reviewSteps = result.data.steps.filter(s => s.verdicts);
      expect(reviewSteps.length).toBeGreaterThan(0);

      for (const step of reviewSteps) {
        for (const [, verdict] of Object.entries(step.verdicts!)) {
          expect(stepIds.has(verdict.target)).toBe(true);
        }
      }
    });

    it('script steps have plugin and agent config', () => {
      const result = loadDefinition();
      expect(result.success).toBe(true);
      if (!result.success) return;

      const scriptSteps = result.data.steps.filter(s => s.executor === 'script');
      expect(scriptSteps.length).toBeGreaterThan(0);

      for (const step of scriptSteps) {
        expect(step.plugin).toBe('script-container');
        expect(step.agent).toBeDefined();
        expect(step.agent?.runtime).toBe('javascript');
      }
    });

    it('has a cowork design step with outputSchema', () => {
      const result = loadDefinition();
      expect(result.success).toBe(true);
      if (!result.success) return;

      const coworkSteps = result.data.steps.filter(s => s.executor === 'cowork');
      expect(coworkSteps).toHaveLength(1);
      expect(coworkSteps[0].id).toBe('design');
      expect(coworkSteps[0].cowork).toBeDefined();
      expect(coworkSteps[0].cowork?.outputSchema).toBeDefined();
      expect(coworkSteps[0].cowork?.systemPrompt).toBeDefined();
    });

    it('choose-mode branches to create-new or edit-existing paths', () => {
      const result = loadDefinition();
      expect(result.success).toBe(true);
      if (!result.success) return;

      const transitions = result.data.transitions.filter(t => t.from === 'choose-mode');
      expect(transitions).toHaveLength(2);

      const targets = transitions.map(t => t.to).sort();
      expect(targets).toEqual(['design', 'fetch-workflows']);
    });
  });
});
