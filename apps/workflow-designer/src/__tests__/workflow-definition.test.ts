import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  WorkflowDefinitionSchema,
  getWorkflowAuthorableJsonSchema,
  resolveCoworkOutputSchema,
  parseWorkflowTemplate,
  type WorkflowDefinition,
} from '@mediforce/platform-core';
import { resolveTransitions } from '@mediforce/workflow-engine';

describe('workflow-designer', () => {
  const appDir = resolve(import.meta.dirname, '../..');

  function loadDefinition(file = 'workflow-designer.wd.json') {
    const raw = JSON.parse(
      readFileSync(resolve(appDir, 'src', file), 'utf8'),
    );
    return WorkflowDefinitionSchema.safeParse({ ...raw, version: 1 });
  }

  function parsedDefinition(file = 'workflow-designer.wd.json'): WorkflowDefinition {
    const result = loadDefinition(file);
    if (!result.success) throw new Error(`${file} failed to parse: ${result.error.message}`);
    return result.data;
  }

  function route(def: WorkflowDefinition, from: string, output: Record<string, unknown>): string[] {
    const outgoing = def.transitions.filter((transition) => transition.from === from);
    return resolveTransitions(outgoing, { output, variables: {} }).map((resolved) => resolved.to);
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

    it('resolves the live schema when the design session is created', () => {
      const result = loadDefinition();
      expect(result.success).toBe(true);
      if (!result.success) return;

      const designStep = result.data.steps.find(step => step.id === 'design');
      expect(designStep?.cowork?.outputSchemaRef).toBe('workflow-definition-authorable');
      expect(designStep?.cowork?.outputSchema).toBeUndefined();
      expect(
        result.data.transitions.some(t => t.from === 'fetch-schema' || t.to === 'fetch-schema'),
      ).toBe(false);
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

    it('script steps have plugin and script config', () => {
      const result = loadDefinition();
      expect(result.success).toBe(true);
      if (!result.success) return;

      const scriptSteps = result.data.steps.filter(s => s.executor === 'script');
      expect(scriptSteps.length).toBeGreaterThan(0);

      for (const step of scriptSteps) {
        expect(step.plugin).toBe('script-container');
        expect(step.script).toBeDefined();
        expect(step.script?.runtime).toBe('javascript');
      }
    });

    it('has a cowork design step with a runtime output schema ref', () => {
      const result = loadDefinition();
      expect(result.success).toBe(true);
      if (!result.success) return;

      const coworkSteps = result.data.steps.filter(s => s.executor === 'cowork');
      expect(coworkSteps).toHaveLength(1);
      expect(coworkSteps[0].id).toBe('design');
      expect(coworkSteps[0].cowork).toBeDefined();
      expect(coworkSteps[0].cowork?.outputSchema).toBeUndefined();
      expect(coworkSteps[0].cowork?.outputSchemaRef).toBe('workflow-definition-authorable');
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

  describe('design → validate → register loop routing', () => {
    it('routes choose-mode to the create or edit path by selected mode', () => {
      const def = parsedDefinition();
      expect(route(def, 'choose-mode', { mode: 'create-new' })).toEqual(['design']);
      expect(route(def, 'choose-mode', { mode: 'edit-existing' })).toEqual(['fetch-workflows']);
    });

    it('design always advances to validate', () => {
      expect(route(parsedDefinition(), 'design', {})).toEqual(['validate']);
    });

    it('validate advances to register when valid and loops back to design when invalid', () => {
      const def = parsedDefinition();
      expect(route(def, 'validate', { valid: true })).toEqual(['register']);
      expect(route(def, 'validate', { valid: false })).toEqual(['design']);
    });

    it('register advances to the terminal step', () => {
      expect(route(parsedDefinition(), 'register', {})).toEqual(['done']);
    });
  });

  describe('design and validate steps share one schema', () => {
    it('design output schema is the live authorable schema the validate step enforces', () => {
      const def = parsedDefinition();
      const designStep = def.steps.find((step) => step.id === 'design');
      const designSchema = resolveCoworkOutputSchema(designStep?.cowork) as {
        properties?: Record<string, unknown>;
      };

      // The design step tells the model to produce exactly the schema that
      // /api/workflow-definitions/schema serves — not a baked inline copy.
      expect(designSchema).toEqual(getWorkflowAuthorableJsonSchema());

      // The validate step (POST /api/workflow-definitions/validate → parseWorkflowTemplate)
      // omits the same server-managed keys the authorable schema omits, so a
      // design-conformant document validates and one carrying an omitted key is
      // rejected. This is what stops the loop false-rejecting on schema drift.
      const serverManaged = ['namespace', 'version', 'createdAt'];
      const designProps = Object.keys(designSchema.properties ?? {});
      for (const key of serverManaged) {
        expect(designProps).not.toContain(key);
      }

      const candidate = {
        name: 'loop-parity',
        steps: [
          { id: 'start', name: 'Start', type: 'creation', executor: 'human' },
          { id: 'end', name: 'End', type: 'terminal', executor: 'human' },
        ],
        transitions: [{ from: 'start', to: 'end' }],
        triggers: [{ type: 'manual', name: 'manual' }],
      };
      expect(parseWorkflowTemplate(candidate).success).toBe(true);
      expect(parseWorkflowTemplate({ ...candidate, namespace: 'x' }).success).toBe(false);
    });
  });

  describe('voice-workflow-designer.wd.json', () => {
    it('uses the runtime workflow schema ref instead of a baked output schema', () => {
      const result = loadDefinition('voice-workflow-designer.wd.json');
      expect(result.success).toBe(true);
      if (!result.success) return;

      const designStep = result.data.steps.find(step => step.id === 'design');
      expect(designStep?.cowork?.outputSchema).toBeUndefined();
      expect(designStep?.cowork?.outputSchemaRef).toBe('workflow-definition-authorable');
    });
  });
});
