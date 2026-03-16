import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseProcessDefinition } from '../process-parser.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function loadFixture(name: string): string {
  return readFileSync(join(__dirname, 'fixtures', name), 'utf-8');
}

describe('parseProcessDefinition', () => {
  describe('valid YAML parsing', () => {
    it('parses minimal YAML into a ProcessDefinition with correct fields', () => {
      const yaml = loadFixture('minimal-valid.yaml');
      const result = parseProcessDefinition(yaml);

      expect(result.success).toBe(true);
      if (!result.success) return;

      expect(result.data.name).toBe('simple-process');
      expect(result.data.version).toBe('1.0');
      expect(result.data.steps).toHaveLength(2);
      expect(result.data.transitions).toHaveLength(1);
      expect(result.data.triggers).toHaveLength(1);
    });

    it('parses full YAML with all optional fields correctly', () => {
      const yaml = loadFixture('full-valid.yaml');
      const result = parseProcessDefinition(yaml);

      expect(result.success).toBe(true);
      if (!result.success) return;

      expect(result.data.name).toBe('supply-chain-review');
      expect(result.data.description).toBe('Review supplier compliance and quality signals');
      expect(result.data.metadata).toEqual({
        department: 'supply-operations',
        classification: 'critical',
      });
      expect(result.data.steps).toHaveLength(4);
      expect(result.data.transitions).toHaveLength(1);
      expect(result.data.triggers).toHaveLength(2);
    });

    it('parses review step verdicts with correct target step IDs', () => {
      const yaml = loadFixture('review-step-with-verdicts.yaml');
      const result = parseProcessDefinition(yaml);

      expect(result.success).toBe(true);
      if (!result.success) return;

      const reviewStep = result.data.steps.find(
        (s) => s.type === 'review',
      );
      expect(reviewStep).toBeDefined();
      expect(reviewStep!.verdicts).toEqual({
        approve: { target: 'approved' },
        revise: { target: 'intake' },
        reject: { target: 'rejected' },
      });
    });

    it('preserves step order from YAML', () => {
      const yaml = loadFixture('full-valid.yaml');
      const result = parseProcessDefinition(yaml);

      expect(result.success).toBe(true);
      if (!result.success) return;

      const stepIds = result.data.steps.map((s) => s.id);
      expect(stepIds).toEqual([
        'collect-data',
        'review',
        'complete',
        'closed',
      ]);
    });

    it('when conditions are strings (not resolved at parse time)', () => {
      const yaml = loadFixture('full-valid.yaml');
      const result = parseProcessDefinition(yaml);

      expect(result.success).toBe(true);
      if (!result.success) return;

      const conditionalTransition = result.data.transitions.find(
        (t) => t.when !== undefined,
      );
      expect(conditionalTransition).toBeDefined();
      expect(typeof conditionalTransition!.when).toBe('string');
      expect(conditionalTransition!.when).toBe('output.dataComplete == true');
    });
  });

  describe('YAML syntax errors', () => {
    it('returns success: false with error for invalid YAML syntax', () => {
      const yaml = loadFixture('invalid-yaml-syntax.yaml');
      const result = parseProcessDefinition(yaml);

      expect(result.success).toBe(false);
      if (result.success) return;

      expect(result.error.toLowerCase()).toMatch(/yaml/i);
    });

    it('includes line/column information in YAML syntax error messages', () => {
      const yaml = loadFixture('invalid-yaml-syntax.yaml');
      const result = parseProcessDefinition(yaml);

      expect(result.success).toBe(false);
      if (result.success) return;

      // The yaml library includes position info like "at line X, column Y"
      expect(result.error).toMatch(/\d/);
    });
  });

  describe('schema validation errors', () => {
    it('returns error mentioning "triggers" when triggers are missing', () => {
      const yaml = loadFixture('invalid-schema.yaml');
      const result = parseProcessDefinition(yaml);

      expect(result.success).toBe(false);
      if (result.success) return;

      expect(result.error.toLowerCase()).toContain('triggers');
    });

    it('returns error mentioning step type for unknown step type', () => {
      const yaml = loadFixture('invalid-schema.yaml');
      const result = parseProcessDefinition(yaml);

      expect(result.success).toBe(false);
      if (result.success) return;

      expect(result.error).toMatch(/steps[.\[]0[.\]]*.*type|type.*steps/i);
    });

    it('returns error mentioning "name" when step name is missing', () => {
      const yaml = loadFixture('invalid-schema.yaml');
      const result = parseProcessDefinition(yaml);

      expect(result.success).toBe(false);
      if (result.success) return;

      expect(result.error.toLowerCase()).toContain('name');
    });

    it('includes field paths in schema error messages', () => {
      const yaml = loadFixture('invalid-schema.yaml');
      const result = parseProcessDefinition(yaml);

      expect(result.success).toBe(false);
      if (result.success) return;

      // Expect paths like "steps.0.type" or "steps.0.name"
      expect(result.error).toMatch(/steps\.0\./);
    });
  });

  describe('edge cases', () => {
    it('returns error for empty string input', () => {
      const result = parseProcessDefinition('');

      expect(result.success).toBe(false);
      if (result.success) return;

      expect(result.error).toBeTruthy();
    });

    it('returns error for YAML with only comments', () => {
      const result = parseProcessDefinition('# just a comment\n# nothing else');

      expect(result.success).toBe(false);
      if (result.success) return;

      expect(result.error).toBeTruthy();
    });

    it('returns error for null/undefined input', () => {
      const result1 = parseProcessDefinition(null);
      expect(result1.success).toBe(false);

      const result2 = parseProcessDefinition(undefined);
      expect(result2.success).toBe(false);
    });
  });
});
