import { readdirSync, readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { describe, it, expect } from 'vitest';
import {
  WorkflowTemplateSchema,
  WorkflowDefinitionBaseSchema,
  parseWorkflowDefinitionForCreation,
} from '../workflow-definition.js';

const examplesDir = resolve(__dirname, '../../../../../docs/workflow-examples');
const antiPatternsDir = resolve(examplesDir, 'anti-patterns');

const examples = readdirSync(examplesDir)
  .filter(f => f.endsWith('.wd.json'))
  .sort()
  .map(f => ({
    file: f,
    content: JSON.parse(readFileSync(resolve(examplesDir, f), 'utf8')),
  }));

const antiPatterns = existsSync(antiPatternsDir)
  ? readdirSync(antiPatternsDir)
      .filter(f => f.endsWith('.json'))
      .sort()
      .map(f => {
        const raw = JSON.parse(readFileSync(resolve(antiPatternsDir, f), 'utf8'));
        return { file: f, ...raw };
      })
  : [];

describe('workflow examples', () => {
  it('found at least one example', () => {
    expect(examples.length).toBeGreaterThan(0);
  });

  describe.each(examples)('$file', ({ file, content }) => {
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
      expect(content.name).toMatch(/^tutorial-/);
      expect(content.title).toBeTruthy();
      expect(content.description.length).toBeGreaterThan(20);
    });

    it('has at least one trigger', () => {
      expect(content.triggers.length).toBeGreaterThan(0);
    });

    it('has exactly one terminal step', () => {
      const terminals = content.steps.filter((s: { type: string }) => s.type === 'terminal');
      expect(terminals).toHaveLength(1);
    });

    it('all transition targets reference existing step ids', () => {
      const stepIds = new Set(content.steps.map((s: { id: string }) => s.id));
      for (const t of content.transitions) {
        expect(stepIds.has(t.from), `transition.from "${t.from}" not in steps`).toBe(true);
        expect(stepIds.has(t.to), `transition.to "${t.to}" not in steps`).toBe(true);
      }
    });

    it('review steps have verdicts pointing to valid steps', () => {
      const stepIds = new Set(content.steps.map((s: { id: string }) => s.id));
      const reviewSteps = content.steps.filter((s: { type: string }) => s.type === 'review');
      for (const step of reviewSteps) {
        expect(step.verdicts, `review step "${step.id}" missing verdicts`).toBeTruthy();
        for (const [verdict, config] of Object.entries(step.verdicts)) {
          const target = (config as { target: string }).target;
          expect(stepIds.has(target), `verdict "${verdict}" target "${target}" not in steps`).toBe(true);
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
      const reviewIds = new Set(
        content.steps
          .filter((s: { type: string }) => s.type === 'review')
          .map((s: { id: string }) => s.id),
      );
      const badTransitions = content.transitions.filter(
        (t: { from: string }) => reviewIds.has(t.from),
      );
      expect(badTransitions, 'review steps must not have outgoing transitions').toHaveLength(0);
    });
  });
});

describe('workflow anti-patterns', () => {
  it('found at least one anti-pattern', () => {
    expect(antiPatterns.length).toBeGreaterThan(0);
  });

  describe.each(antiPatterns)('$name', ({ file, name, description, expectedError, definition, validatesAs }) => {
    it('has required metadata', () => {
      expect(name).toBeTruthy();
      expect(description).toBeTruthy();
      expect(expectedError).toBeTruthy();
    });

    if (validatesAs === 'logic') {
      it('violates best-practice rule', () => {
        const def = definition;
        const reviewSteps = (def.steps ?? []).filter((s: { type: string }) => s.type === 'review');

        if (name === 'transition-from-review') {
          const reviewIds = new Set(reviewSteps.map((s: { id: string }) => s.id));
          const bad = (def.transitions ?? []).filter((t: { from: string }) => reviewIds.has(t.from));
          expect(bad.length, `should have transitions from review steps`).toBeGreaterThan(0);
        } else if (name === 'review-without-verdicts') {
          const missing = reviewSteps.filter((s: { verdicts?: unknown }) => !s.verdicts);
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
