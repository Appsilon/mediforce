import { resolve } from 'path';
import { describe, it, expect } from 'vitest';
import {
  WorkflowTemplateSchema,
  WorkflowDefinitionBaseSchema,
  parseWorkflowDefinitionForCreation,
} from '../workflow-definition.js';
import { loadWorkflowExamples } from '../../workflow-examples.js';

const repoRoot = resolve(__dirname, '../../../../..');
const { examples, antiPatterns } = loadWorkflowExamples(repoRoot);

describe('workflow examples', () => {
  it('found at least one example', () => {
    expect(examples.length).toBeGreaterThan(0);
  });

  describe.each(examples)('$file', ({ file, definition: content }) => {
    it('parses against WorkflowTemplateSchema', () => {
      const result = WorkflowTemplateSchema.safeParse(content);
      if (!result.success) {
        const messages = result.error.issues.map(
          i => `  ${i.path.join('.')}: ${i.message}`,
        );
        throw new Error(`${file} failed schema validation:\n${messages.join('\n')}`);
      }
      expect(result.success).toBe(true);
    });

    it('has required example metadata', () => {
      expect((content as Record<string, unknown>).name).toMatch(/^tutorial-/);
      expect((content as Record<string, unknown>).title).toBeTruthy();
      expect(((content as Record<string, unknown>).description as string).length).toBeGreaterThan(20);
    });

    it('has at least one trigger', () => {
      expect(((content as Record<string, unknown>).triggers as unknown[]).length).toBeGreaterThan(0);
    });

    it('has exactly one terminal step', () => {
      const steps = (content as Record<string, unknown>).steps as Array<{ type: string }>;
      const terminals = steps.filter(s => s.type === 'terminal');
      expect(terminals).toHaveLength(1);
    });

    it('all transition targets reference existing step ids', () => {
      const steps = (content as Record<string, unknown>).steps as Array<{ id: string }>;
      const transitions = (content as Record<string, unknown>).transitions as Array<{ from: string; to: string }>;
      const stepIds = new Set(steps.map(s => s.id));
      for (const t of transitions) {
        expect(stepIds.has(t.from), `transition.from "${t.from}" not in steps`).toBe(true);
        expect(stepIds.has(t.to), `transition.to "${t.to}" not in steps`).toBe(true);
      }
    });

    it('review steps have verdicts pointing to valid steps', () => {
      const steps = (content as Record<string, unknown>).steps as Array<{ id: string; type: string; verdicts?: Record<string, { target: string }> }>;
      const stepIds = new Set(steps.map(s => s.id));
      const reviewSteps = steps.filter(s => s.type === 'review');
      for (const step of reviewSteps) {
        expect(step.verdicts, `review step "${step.id}" missing verdicts`).toBeTruthy();
        for (const [verdict, config] of Object.entries(step.verdicts!)) {
          expect(stepIds.has(config.target), `verdict "${verdict}" target "${config.target}" not in steps`).toBe(true);
        }
      }
    });

    it('passes registration validation (L2)', () => {
      const result = parseWorkflowDefinitionForCreation({
        ...content,
        namespace: 'test',
      });
      if (!result.success) {
        const messages = result.error.issues.map(
          i => `  ${i.path.join('.')}: ${i.message}`,
        );
        throw new Error(`${file} failed registration validation:\n${messages.join('\n')}`);
      }
      expect(result.success).toBe(true);
    });

    it('no transitions FROM review steps (engine uses verdicts)', () => {
      const steps = (content as Record<string, unknown>).steps as Array<{ id: string; type: string }>;
      const transitions = (content as Record<string, unknown>).transitions as Array<{ from: string }>;
      const reviewIds = new Set(
        steps.filter(s => s.type === 'review').map(s => s.id),
      );
      const badTransitions = transitions.filter(t => reviewIds.has(t.from));
      expect(badTransitions, 'review steps must not have outgoing transitions').toHaveLength(0);
    });
  });
});

describe('workflow anti-patterns', () => {
  it('found at least one anti-pattern', () => {
    expect(antiPatterns.length).toBeGreaterThan(0);
  });

  describe.each(antiPatterns)('$name', ({ name, description, expectedError, definition, validatesAs }) => {
    it('has required metadata', () => {
      expect(name).toBeTruthy();
      expect(description).toBeTruthy();
      expect(expectedError).toBeTruthy();
    });

    if (validatesAs === 'logic') {
      it('violates best-practice rule', () => {
        const def = definition as Record<string, unknown>;
        const steps = (def.steps ?? []) as Array<{ id: string; type: string; verdicts?: unknown }>;
        const reviewSteps = steps.filter(s => s.type === 'review');

        if (name === 'transition-from-review') {
          const reviewIds = new Set(reviewSteps.map(s => s.id));
          const transitions = (def.transitions ?? []) as Array<{ from: string }>;
          const bad = transitions.filter(t => reviewIds.has(t.from));
          expect(bad.length, `should have transitions from review steps`).toBeGreaterThan(0);
        } else if (name === 'review-without-verdicts') {
          const missing = reviewSteps.filter(s => !s.verdicts);
          expect(missing.length, `should have review steps without verdicts`).toBeGreaterThan(0);
        } else {
          throw new Error(`Unknown logic anti-pattern: ${name}`);
        }
      });
    } else {
      it('is correctly rejected by schema validation', () => {
        const schema = validatesAs === 'full-definition'
          ? WorkflowDefinitionBaseSchema
          : WorkflowTemplateSchema;
        const result = schema.safeParse(definition);
        expect(result.success, `anti-pattern "${name}" should FAIL validation but passed`).toBe(false);
        if (!result.success) {
          const allMessages = result.error.issues.map(i => i.message).join(' | ');
          expect(
            allMessages,
            `anti-pattern "${name}" error should match /${expectedError}/`,
          ).toMatch(new RegExp(expectedError, 'i'));
        }
      });
    }
  });
});
