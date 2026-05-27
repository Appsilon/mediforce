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

  it('has exactly one terminal step and eight total', () => {
    const result = loadDefinition();
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.steps).toHaveLength(8);
    expect(result.data.steps.filter((s) => s.type === 'terminal')).toHaveLength(1);
  });

  it('declares triggerInput for repo, labelFilter, limit, sprintDays', () => {
    const result = loadDefinition();
    expect(result.success).toBe(true);
    if (!result.success) return;
    const params = result.data.triggerInput ?? [];
    const names = params.map((p) => p.name);
    expect(names).toEqual(['repo', 'labelFilter', 'limit', 'sprintDays', 'pulseContext']);
    expect(params.find((p) => p.name === 'sprintDays')?.default).toBe(5);
  });

  it('pulseContext triggerInput is optional', () => {
    const result = loadDefinition();
    expect(result.success).toBe(true);
    if (!result.success) return;
    const params = result.data.triggerInput ?? [];
    const pulse = params.find((p) => p.name === 'pulseContext');
    expect(pulse?.required).toBe(false);
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

  it('fetch-backlog, check-tags, and dispatch run on golden image with javascript inlineScript', () => {
    const result = loadDefinition();
    expect(result.success).toBe(true);
    if (!result.success) return;
    for (const stepId of ['fetch-backlog', 'check-tags', 'dispatch', 'apply-tags']) {
      const step = result.data.steps.find((s) => s.id === stepId);
      expect(step?.executor).toBe('script');
      expect(step?.plugin).toBe('script-container');
      expect(step?.agent?.image).toBe('mediforce-golden-image:latest');
      expect(step?.agent?.runtime).toBe('javascript');
      expect(step?.agent?.inlineScript).toBeDefined();
    }
  });

  it('check-tags carries untagged issues forward as options and writes no presentation file', () => {
    const result = loadDefinition();
    expect(result.success).toBe(true);
    if (!result.success) return;
    const step = result.data.steps.find((s) => s.id === 'check-tags');
    expect(step?.agent?.inlineScript).toMatch(/options: untagged/);
    expect(step?.agent?.inlineScript).not.toMatch(/presentation\./);
    expect(step?.agent?.inlineScript).toMatch(/needsTagging/);
  });

  it('tag-issues is a human table-editor step (category + priority) with no verdict', () => {
    const result = loadDefinition();
    expect(result.success).toBe(true);
    if (!result.success) return;
    const step = result.data.steps.find((s) => s.id === 'tag-issues');
    expect(step?.executor).toBe('human');
    expect(step?.ui?.component).toBe('table-editor');
    expect(step?.verdicts).toBeUndefined();
    const config = step?.ui?.config as Record<string, unknown>;
    const columns = config.columns as Array<{ id: string; kind: string; allowEmpty?: boolean }>;
    expect(columns.find((c) => c.id === 'category')?.kind).toBe('single-select');
    expect(columns.find((c) => c.id === 'category')?.allowEmpty).toBe(false);
    expect(columns.some((c) => c.id === 'priority')).toBe(true);
  });

  it('tag-issues → apply-tags → fetch-backlog forms the tagging loop', () => {
    const result = loadDefinition();
    expect(result.success).toBe(true);
    if (!result.success) return;
    const t = (from: string, to: string) =>
      result.data.transitions.some((tr) => tr.from === from && tr.to === to);
    expect(t('tag-issues', 'apply-tags')).toBe(true);
    expect(t('apply-tags', 'fetch-backlog')).toBe(true);
    const applyTags = result.data.steps.find((s) => s.id === 'apply-tags');
    expect(applyTags?.executor).toBe('script');
    expect(applyTags?.agent?.inlineScript).toMatch(/issues\/\$\{itemId\}\/labels/);
  });

  it('propose-assignments is an L4 agent step that mentions sprintDays + AI-bottleneck guidance', () => {
    const result = loadDefinition();
    expect(result.success).toBe(true);
    if (!result.success) return;
    const step = result.data.steps.find((s) => s.id === 'propose-assignments');
    expect(step?.executor).toBe('agent');
    expect(step?.autonomyLevel).toBe('L4');
    expect(step?.agent?.prompt).toMatch(/sprintDays/);
    expect(step?.agent?.prompt).toMatch(/reviewer/i);
  });

  it('transitions branch on check-tags.needsTagging output', () => {
    const result = loadDefinition();
    expect(result.success).toBe(true);
    if (!result.success) return;
    const fromCheck = result.data.transitions.filter((t) => t.from === 'check-tags');
    expect(fromCheck).toHaveLength(2);
    expect(fromCheck.find((t) => t.to === 'tag-issues')?.when).toBe('output.needsTagging == true');
    expect(fromCheck.find((t) => t.to === 'propose-assignments')?.when).toBe('output.needsTagging == false');
  });

  it('straight-line happy path: fetch → check → propose → assign → dispatch → report', () => {
    const result = loadDefinition();
    expect(result.success).toBe(true);
    if (!result.success) return;
    const t = (from: string, to: string, when?: string) =>
      result.data.transitions.some((tr) => tr.from === from && tr.to === to && tr.when === when);
    expect(t('fetch-backlog', 'check-tags')).toBe(true);
    expect(t('check-tags', 'propose-assignments', 'output.needsTagging == false')).toBe(true);
    expect(t('propose-assignments', 'assign')).toBe(true);
    expect(t('assign', 'dispatch')).toBe(true);
    expect(t('dispatch', 'report')).toBe(true);
  });
});
