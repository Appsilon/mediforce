import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { WorkflowDefinitionSchema } from '@mediforce/platform-core';

describe('team-pulse', () => {
  const appDir = resolve(import.meta.dirname, '../..');

  function loadDefinition() {
    const raw = JSON.parse(
      readFileSync(resolve(appDir, 'src/team-pulse.wd.json'), 'utf8'),
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

  it('has 8 steps with exactly 1 terminal', () => {
    const result = loadDefinition();
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.steps).toHaveLength(8);
    expect(result.data.steps.filter((s) => s.type === 'terminal')).toHaveLength(1);
  });

  it('prepare step parses teamMembers and computes deadline from durationHours', () => {
    const result = loadDefinition();
    expect(result.success).toBe(true);
    if (!result.success) return;
    const step = result.data.steps.find((s) => s.id === 'prepare');
    expect(step?.executor).toBe('script');
    expect(step?.agent?.inlineScript).toMatch(/JSON\.parse/);
    expect(step?.agent?.inlineScript).toMatch(/durationHours/);
    expect(step?.agent?.inlineScript).toMatch(/deadline/);
  });

  it('spawn_perspectives is action step with spawn kind and forEach', () => {
    const result = loadDefinition();
    expect(result.success).toBe(true);
    if (!result.success) return;
    const step = result.data.steps.find((s) => s.id === 'spawn_perspectives');
    expect(step?.executor).toBe('action');
    expect(step?.action).toBeDefined();
    const action = step?.action as { kind: string; config: Record<string, unknown> };
    expect(action.kind).toBe('spawn');
    expect(action.config.forEach).toBeDefined();
  });

  it('wait_for_responses is action step with wait kind', () => {
    const result = loadDefinition();
    expect(result.success).toBe(true);
    if (!result.success) return;
    const step = result.data.steps.find((s) => s.id === 'wait_for_responses');
    expect(step?.executor).toBe('action');
    expect(step?.action).toBeDefined();
    const action = step?.action as { kind: string; config: Record<string, unknown> };
    expect(action.kind).toBe('wait');
    expect(action.config.deadline).toBeDefined();
  });

  it('collect_responses is script step on golden image', () => {
    const result = loadDefinition();
    expect(result.success).toBe(true);
    if (!result.success) return;
    const step = result.data.steps.find((s) => s.id === 'collect_responses');
    expect(step?.executor).toBe('script');
    expect(step?.plugin).toBe('script-container');
    expect(step?.agent?.image).toBe('mediforce-golden-image:latest');
    expect(step?.agent?.runtime).toBe('javascript');
    expect(step?.agent?.inlineScript).toBeDefined();
  });

  it('synthesize is agent step with OpenRouter env', () => {
    const result = loadDefinition();
    expect(result.success).toBe(true);
    if (!result.success) return;
    const step = result.data.steps.find((s) => s.id === 'synthesize');
    expect(step?.executor).toBe('agent');
    expect(step?.plugin).toBe('claude-code-agent');
    expect(step?.autonomyLevel).toBe('L4');
    expect(step?.env?.ANTHROPIC_AUTH_TOKEN).toBe('{{OPENROUTER_API_KEY}}');
    expect(step?.env?.ANTHROPIC_BASE_URL).toBe('https://openrouter.ai/api');
    expect(step?.agent?.model).toBe('sonnet');
    expect(step?.agent?.prompt).toMatch(/synthesis/i);
  });

  it('decide_triage is human decision step with launch_triage and skip verdicts', () => {
    const result = loadDefinition();
    expect(result.success).toBe(true);
    if (!result.success) return;
    const step = result.data.steps.find((s) => s.id === 'decide_triage');
    expect(step?.executor).toBe('human');
    expect(step?.type).toBe('decision');
    expect(step?.allowedRoles).toEqual(['product-owner']);
    expect(step?.verdicts).toBeDefined();
    const verdicts = step?.verdicts as Record<string, { target: string; label?: string; intent?: string }>;
    expect(verdicts.launch_triage).toBeDefined();
    expect(verdicts.launch_triage.intent).toBe('success');
    expect(verdicts.skip).toBeDefined();
    expect(verdicts.skip.intent).toBe('neutral');
  });

  it('spawn_triage spawns backlog-triage with pulseContext in payload', () => {
    const result = loadDefinition();
    expect(result.success).toBe(true);
    if (!result.success) return;
    const step = result.data.steps.find((s) => s.id === 'spawn_triage');
    expect(step?.executor).toBe('action');
    const action = step?.action as { kind: string; config: { targets: { definitionName: string; payload?: Record<string, unknown> } } };
    expect(action.kind).toBe('spawn');
    expect(action.config.targets.definitionName).toBe('backlog-triage');
    expect(action.config.targets.payload?.pulseContext).toBeDefined();
  });

  it('transitions branch on verdict key from decide_triage', () => {
    const result = loadDefinition();
    expect(result.success).toBe(true);
    if (!result.success) return;
    const fromDecide = result.data.transitions.filter((t) => t.from === 'decide_triage');
    expect(fromDecide).toHaveLength(2);
    expect(fromDecide.find((t) => t.to === 'spawn_triage')?.when).toBe('verdict == "launch_triage"');
    expect(fromDecide.find((t) => t.to === 'report')?.when).toBe('verdict == "skip"');
  });

  it('declares triggerInput for question, teamMembers, durationHours, repo, labelFilter', () => {
    const result = loadDefinition();
    expect(result.success).toBe(true);
    if (!result.success) return;
    const params = result.data.triggerInput ?? [];
    const names = params.map((p) => p.name);
    expect(names).toEqual(['question', 'teamMembers', 'durationHours', 'repo', 'labelFilter']);
    expect(params.find((p) => p.name === 'durationHours')?.type).toBe('number');
    expect(params.find((p) => p.name === 'repo')?.default).toBe('appsilon/mediforce');
    expect(params.find((p) => p.name === 'labelFilter')?.required).toBe(false);
  });

  it('top-level env references PLATFORM_API_KEY and APP_BASE_URL', () => {
    const result = loadDefinition();
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.env?.PLATFORM_API_KEY).toBe('{{PLATFORM_API_KEY}}');
    expect(result.data.env?.APP_BASE_URL).toBe('{{APP_BASE_URL}}');
  });
});
