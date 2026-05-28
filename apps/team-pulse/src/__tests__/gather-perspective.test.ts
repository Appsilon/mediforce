import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { WorkflowDefinitionSchema } from '@mediforce/platform-core';

describe('gather-perspective', () => {
  const appDir = resolve(import.meta.dirname, '../..');

  function loadDefinition() {
    const raw = JSON.parse(
      readFileSync(resolve(appDir, 'src/gather-perspective.wd.json'), 'utf8'),
    );
    return WorkflowDefinitionSchema.safeParse({ ...raw, version: 1 });
  }

  it('validates against WorkflowDefinitionSchema', () => {
    const result = loadDefinition();
    if (!result.success) {
      console.error(JSON.stringify(result.error.issues, null, 2));
    }
    expect(result.success).toBe(true);
  });

  it('has exactly 3 steps: 2 creation + 1 terminal', () => {
    const result = loadDefinition();
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.steps).toHaveLength(3);
    expect(result.data.steps.filter((s) => s.type === 'creation')).toHaveLength(2);
    expect(result.data.steps.filter((s) => s.type === 'terminal')).toHaveLength(1);
  });

  it('show_question is a script step that renders presentation', () => {
    const result = loadDefinition();
    expect(result.success).toBe(true);
    if (!result.success) return;
    const step = result.data.steps.find((s) => s.id === 'show_question');
    expect(step?.executor).toBe('script');
    expect(step?.agent?.inlineScript).toMatch(/presentation\.md/);
  });

  it('provide_perspective is a human step with textarea param', () => {
    const result = loadDefinition();
    expect(result.success).toBe(true);
    if (!result.success) return;
    const step = result.data.steps.find((s) => s.id === 'provide_perspective');
    expect(step?.executor).toBe('human');
    expect(step?.assignedTo).toBe('${triggerPayload.email}');
    expect(step?.params).toHaveLength(1);
    expect(step?.params?.[0]?.name).toBe('perspective');
    expect(step?.params?.[0]?.type).toBe('textarea');
    expect(step?.allowedRoles).toEqual(['member']);
  });

  it('declares required triggerInput for userId, email, question', () => {
    const result = loadDefinition();
    expect(result.success).toBe(true);
    if (!result.success) return;
    const params = result.data.triggerInput ?? [];
    const names = params.map((p) => p.name);
    expect(names).toEqual(['userId', 'email', 'question']);
    for (const p of params) {
      expect(p.required).toBe(true);
    }
  });

  it('transitions: show_question → provide_perspective → done', () => {
    const result = loadDefinition();
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.transitions).toHaveLength(2);
    expect(result.data.transitions[0]).toEqual({ from: 'show_question', to: 'provide_perspective' });
    expect(result.data.transitions[1]).toEqual({ from: 'provide_perspective', to: 'done' });
  });
});
