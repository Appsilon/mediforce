import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { WorkflowDefinitionSchema } from '@mediforce/platform-core';

describe('workflow-designer-2', () => {
  const appDir = resolve(import.meta.dirname, '../..');

  function loadDefinition() {
    const raw = JSON.parse(
      readFileSync(resolve(appDir, 'src/workflow-designer-2.wd.json'), 'utf8'),
    );
    // Add version (auto-assigned by server, not in source file)
    return WorkflowDefinitionSchema.safeParse({ ...raw, version: 1 });
  }

  describe('workflow-designer-2.wd.json', () => {
    it('validates against WorkflowDefinitionSchema', () => {
      const result = loadDefinition();

      expect(result.success).toBe(true);
      if (!result.success) return;

      expect(result.data.name).toBe('workflow-designer-2');
      expect(result.data.steps).toHaveLength(9);
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
        expect(['human', 'agent', 'script']).toContain(step.executor);
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

    it('agent steps have plugin and agent config', () => {
      const result = loadDefinition();
      expect(result.success).toBe(true);
      if (!result.success) return;

      const agentSteps = result.data.steps.filter(s => s.executor === 'agent');
      expect(agentSteps.length).toBeGreaterThan(0);

      for (const step of agentSteps) {
        expect(step.plugin).toBeDefined();
        expect(step.agent).toBeDefined();
      }
    });

    it('agent steps reference workflow-designer-2 skills directory', () => {
      const result = loadDefinition();
      expect(result.success).toBe(true);
      if (!result.success) return;

      const agentSteps = result.data.steps.filter(s => s.executor === 'agent');
      for (const step of agentSteps) {
        expect(step.agent?.skillsDir).toContain('workflow-designer-2');
      }
    });
  });
});
