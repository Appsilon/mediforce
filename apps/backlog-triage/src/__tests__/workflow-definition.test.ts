import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { WorkflowDefinitionSchema } from '@mediforce/platform-core';

describe('backlog-triage', () => {
  const appDir = resolve(import.meta.dirname, '../..');

  function loadDefinition() {
    const raw = JSON.parse(
      readFileSync(resolve(appDir, 'src/backlog-triage.wd.json'), 'utf8'),
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

  it('has exactly one terminal step and five total', () => {
    const result = loadDefinition();
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.steps).toHaveLength(5);
    expect(result.data.steps.filter((s) => s.type === 'terminal')).toHaveLength(1);
  });

  it('declares triggerInput for repo and labelFilter', () => {
    const result = loadDefinition();
    expect(result.success).toBe(true);
    if (!result.success) return;
    const names = (result.data.triggerInput ?? []).map((p) => p.name);
    expect(names).toContain('repo');
    expect(names).toContain('labelFilter');
  });

  it('assign step uses assignment-table with assignees and priorities in ui.config', () => {
    const result = loadDefinition();
    expect(result.success).toBe(true);
    if (!result.success) return;
    const assign = result.data.steps.find((s) => s.id === 'assign');
    expect(assign?.ui?.component).toBe('assignment-table');
    const config = assign?.ui?.config as Record<string, unknown>;
    const assignees = config.assignees as Array<{ id: string; kind: string }>;
    expect(Array.isArray(assignees)).toBe(true);
    expect(assignees.length).toBeGreaterThan(0);
    expect(assignees.some((a) => a.kind === 'agent')).toBe(true);
    expect(config.priorities).toEqual(['P0', 'P1', 'P2', 'P3']);
  });

  it('env references the three workflow secrets', () => {
    const result = loadDefinition();
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.env?.GITHUB_TOKEN).toBe('{{GITHUB_TOKEN}}');
    expect(result.data.env?.PLATFORM_API_KEY).toBe('{{PLATFORM_API_KEY}}');
    expect(result.data.env?.APP_BASE_URL).toBe('{{APP_BASE_URL}}');
  });

  it('fetch-backlog and dispatch run on golden image with javascript inlineScript', () => {
    const result = loadDefinition();
    expect(result.success).toBe(true);
    if (!result.success) return;
    for (const stepId of ['fetch-backlog', 'dispatch']) {
      const step = result.data.steps.find((s) => s.id === stepId);
      expect(step?.executor).toBe('script');
      expect(step?.plugin).toBe('script-container');
      expect(step?.agent?.image).toBe('mediforce-golden-image:latest');
      expect(step?.agent?.runtime).toBe('javascript');
      expect(step?.agent?.inlineScript).toBeDefined();
    }
  });

  it('propose-assignments is an L4 agent step with an inline prompt', () => {
    const result = loadDefinition();
    expect(result.success).toBe(true);
    if (!result.success) return;
    const step = result.data.steps.find((s) => s.id === 'propose-assignments');
    expect(step?.executor).toBe('agent');
    expect(step?.autonomyLevel).toBe('L4');
    expect(step?.agent?.prompt).toMatch(/options/i);
    expect(step?.agent?.prompt).toMatch(/suggestion/i);
  });

  it('transitions form a single chain through all non-terminal steps', () => {
    const result = loadDefinition();
    expect(result.success).toBe(true);
    if (!result.success) return;
    const chain: string[] = ['fetch-backlog'];
    let current = 'fetch-backlog';
    while (true) {
      const next = result.data.transitions.find((t) => t.from === current);
      if (!next) break;
      chain.push(next.to);
      current = next.to;
    }
    expect(chain).toEqual([
      'fetch-backlog',
      'propose-assignments',
      'assign',
      'dispatch',
      'report',
    ]);
  });
});
