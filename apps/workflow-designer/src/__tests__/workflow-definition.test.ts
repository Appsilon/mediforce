import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { parseProcessDefinition, ProcessConfigSchema } from '@mediforce/platform-core';

describe('workflow-designer', () => {
  const appDir = resolve(import.meta.dirname, '../..');

  describe('workflow-definition.yaml', () => {
    it('parses and validates against ProcessDefinitionSchema', () => {
      const yaml = readFileSync(resolve(appDir, 'src/workflow-definition.yaml'), 'utf8');
      const result = parseProcessDefinition(yaml);

      expect(result.success).toBe(true);
      if (!result.success) return;

      expect(result.data.name).toBe('workflow-designer');
      expect(result.data.version).toBe('5');
      expect(result.data.steps).toHaveLength(9);
      expect(result.data.transitions).toHaveLength(7);
      expect(result.data.triggers).toHaveLength(1);
    });

    it('has exactly one terminal step', () => {
      const yaml = readFileSync(resolve(appDir, 'src/workflow-definition.yaml'), 'utf8');
      const result = parseProcessDefinition(yaml);
      expect(result.success).toBe(true);
      if (!result.success) return;

      const terminals = result.data.steps.filter(s => s.type === 'terminal');
      expect(terminals).toHaveLength(1);
      expect(terminals[0].id).toBe('done');
    });

    it('has all transition targets referencing valid step IDs', () => {
      const yaml = readFileSync(resolve(appDir, 'src/workflow-definition.yaml'), 'utf8');
      const result = parseProcessDefinition(yaml);
      expect(result.success).toBe(true);
      if (!result.success) return;

      const stepIds = new Set(result.data.steps.map(s => s.id));
      for (const transition of result.data.transitions) {
        expect(stepIds.has(transition.from)).toBe(true);
        expect(stepIds.has(transition.to)).toBe(true);
      }
    });

    it('has review step verdicts pointing to valid step IDs', () => {
      const yaml = readFileSync(resolve(appDir, 'src/workflow-definition.yaml'), 'utf8');
      const result = parseProcessDefinition(yaml);
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
  });

  describe('workflow-config-claude.json', () => {
    it('validates against ProcessConfigSchema', () => {
      const raw = JSON.parse(
        readFileSync(resolve(appDir, 'src/workflow-config-claude.json'), 'utf8'),
      );
      const result = ProcessConfigSchema.safeParse(raw);

      expect(result.success).toBe(true);
      if (!result.success) return;

      expect(result.data.processName).toBe('workflow-designer');
      expect(result.data.configName).toBe('claude');
      expect(result.data.stepConfigs).toHaveLength(8);
    });

    it('has step configs matching all non-terminal definition steps', () => {
      const yaml = readFileSync(resolve(appDir, 'src/workflow-definition.yaml'), 'utf8');
      const defResult = parseProcessDefinition(yaml);
      expect(defResult.success).toBe(true);
      if (!defResult.success) return;

      const raw = JSON.parse(
        readFileSync(resolve(appDir, 'src/workflow-config-claude.json'), 'utf8'),
      );
      const cfgResult = ProcessConfigSchema.safeParse(raw);
      expect(cfgResult.success).toBe(true);
      if (!cfgResult.success) return;

      const nonTerminalStepIds = defResult.data.steps
        .filter(s => s.type !== 'terminal')
        .map(s => s.id);
      const configStepIds = cfgResult.data.stepConfigs.map(s => s.stepId);

      for (const stepId of nonTerminalStepIds) {
        expect(configStepIds).toContain(stepId);
      }
    });
  });
});
