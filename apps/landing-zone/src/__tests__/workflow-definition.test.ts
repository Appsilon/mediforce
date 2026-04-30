import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { WorkflowDefinitionSchema } from '@mediforce/platform-core';

describe('landing-zone-CDISCPILOT01.wd.json', () => {
  const appDir = resolve(import.meta.dirname, '../..');

  function loadDefinition() {
    const raw = JSON.parse(
      readFileSync(resolve(appDir, 'src/landing-zone-CDISCPILOT01.wd.json'), 'utf8'),
    );
    return WorkflowDefinitionSchema.safeParse({ ...raw, version: 1 });
  }

  it('validates against WorkflowDefinitionSchema', () => {
    const result = loadDefinition();

    if (!result.success) {
      console.error(result.error.format());
    }
    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.data.name).toBe('landing-zone-CDISCPILOT01');
    expect(result.data.namespace).toBe('appsilon');
  });

  it('has a cron trigger', () => {
    const result = loadDefinition();
    expect(result.success).toBe(true);
    if (!result.success) return;

    const cronTrigger = result.data.triggers.find((t) => t.type === 'cron');
    expect(cronTrigger).toBeDefined();
    expect(cronTrigger?.schedule).toBeDefined();
  });

  it('declares inputForNextRun for SFTP listing carry-over', () => {
    const result = loadDefinition();
    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.data.inputForNextRun).toBeDefined();
    expect(result.data.inputForNextRun?.[0]).toEqual({
      stepId: 'sftp-poll',
      output: 'listing',
      as: 'previousListing',
    });
  });

  it('every non-terminal step has an executor', () => {
    const result = loadDefinition();
    expect(result.success).toBe(true);
    if (!result.success) return;

    const nonTerminal = result.data.steps.filter((step) => step.type !== 'terminal');
    for (const step of nonTerminal) {
      expect(step.executor).toBeDefined();
      expect(['human', 'agent', 'script']).toContain(step.executor);
    }
  });

  it('script steps reference the script-container plugin', () => {
    const result = loadDefinition();
    expect(result.success).toBe(true);
    if (!result.success) return;

    const scriptSteps = result.data.steps.filter(
      (step) => step.executor === 'script' && step.type !== 'terminal',
    );
    expect(scriptSteps.length).toBeGreaterThan(0);

    for (const step of scriptSteps) {
      expect(step.plugin).toBe('script-container');
      expect(step.agent?.image).toBeDefined();
      expect(step.agent?.command).toBeDefined();
    }
  });

  it('agent steps reference claude-code-agent plugin with skill + skillsDir', () => {
    const result = loadDefinition();
    expect(result.success).toBe(true);
    if (!result.success) return;

    const agentSteps = result.data.steps.filter((step) => step.executor === 'agent');
    expect(agentSteps.length).toBeGreaterThan(0);

    for (const step of agentSteps) {
      expect(step.plugin).toBe('claude-code-agent');
      expect(step.agent?.skill).toBeDefined();
      expect(step.agent?.skillsDir).toBe('apps/landing-zone/plugins/landing-zone/skills');
    }
  });

  it('all transition targets reference valid step IDs', () => {
    const result = loadDefinition();
    expect(result.success).toBe(true);
    if (!result.success) return;

    const stepIds = new Set(result.data.steps.map((step) => step.id));
    for (const transition of result.data.transitions) {
      expect(stepIds.has(transition.from)).toBe(true);
      expect(stepIds.has(transition.to)).toBe(true);
    }
  });

  it('review step verdicts reference valid step IDs', () => {
    const result = loadDefinition();
    expect(result.success).toBe(true);
    if (!result.success) return;

    const stepIds = new Set(result.data.steps.map((step) => step.id));
    const reviewSteps = result.data.steps.filter((step) => step.verdicts);
    expect(reviewSteps.length).toBeGreaterThan(0);

    for (const step of reviewSteps) {
      for (const [, verdict] of Object.entries(step.verdicts!)) {
        expect(stepIds.has(verdict.target)).toBe(true);
      }
    }
  });

  it('every non-terminal, non-branching step has an outgoing transition', () => {
    const result = loadDefinition();
    expect(result.success).toBe(true);
    if (!result.success) return;

    for (const step of result.data.steps) {
      if (step.type === 'terminal') continue;
      const hasVerdicts = step.verdicts && Object.keys(step.verdicts).length > 0;
      if (hasVerdicts) continue;
      const hasOutgoing = result.data.transitions.some((transition) => transition.from === step.id);
      expect(hasOutgoing, `Step "${step.id}" should have an outgoing transition`).toBe(true);
    }
  });

  it('declares workspace.remote pointing to dedicated study repo', () => {
    const result = loadDefinition();
    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.data.workspace?.remote).toBe('Appsilon/mediforce-landing-zone-study-demo');
    expect(result.data.workspace?.remoteAuth).toBe('GITHUB_TOKEN');
  });

  it('interpret-validation has 5 classification transitions + an else fallback', () => {
    const result = loadDefinition();
    expect(result.success).toBe(true);
    if (!result.success) return;

    const interpretTransitions = result.data.transitions.filter(
      (transition) => transition.from === 'interpret-validation',
    );
    expect(interpretTransitions).toHaveLength(6);

    const allowedTargets = new Set(['accept-delivery', 'human-review', 'draft-rejection-note']);
    for (const transition of interpretTransitions) {
      expect(transition.when).toBeDefined();
      expect(allowedTargets.has(transition.to)).toBe(true);
    }

    const classificationTransitions = interpretTransitions.filter(
      (transition) => transition.when !== 'else',
    );
    const elseTransitions = interpretTransitions.filter(
      (transition) => transition.when === 'else',
    );

    expect(classificationTransitions).toHaveLength(5);
    for (const transition of classificationTransitions) {
      expect(transition.when).toContain('output.classification');
    }

    const expectedClasses = ['clean', 'minor-fix', 'recovery', 'escalate', 'chaos'];
    for (const className of expectedClasses) {
      const matching = classificationTransitions.filter((transition) =>
        transition.when?.includes(`"${className}"`),
      );
      expect(
        matching.length,
        `expected exactly one transition matching class "${className}"`,
      ).toBe(1);
    }

    const targetByClass = new Map<string, string>();
    for (const transition of classificationTransitions) {
      const matched = expectedClasses.find((className) =>
        transition.when?.includes(`"${className}"`),
      );
      if (matched) targetByClass.set(matched, transition.to);
    }
    expect(targetByClass.get('clean')).toBe('accept-delivery');
    expect(targetByClass.get('minor-fix')).toBe('human-review');
    expect(targetByClass.get('recovery')).toBe('human-review');
    expect(targetByClass.get('escalate')).toBe('draft-rejection-note');
    expect(targetByClass.get('chaos')).toBe('draft-rejection-note');

    expect(elseTransitions).toHaveLength(1);
    expect(elseTransitions[0].to).toBe('human-review');
  });

  it('human-review verdicts unchanged (approve/revise routes preserved)', () => {
    const result = loadDefinition();
    expect(result.success).toBe(true);
    if (!result.success) return;

    const humanReview = result.data.steps.find((step) => step.id === 'human-review');
    expect(humanReview).toBeDefined();
    expect(humanReview?.verdicts).toEqual({
      approve: { target: 'accept-delivery' },
      revise: { target: 'draft-rejection-note' },
    });
  });
});
