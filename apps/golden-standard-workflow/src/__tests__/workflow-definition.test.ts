import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { AgentDefinitionSchema, ToolCatalogEntrySchema, WorkflowDefinitionSchema } from '@mediforce/platform-core';

const appDir = resolve(import.meta.dirname, '../..');

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(resolve(appDir, path), 'utf8'));
}

describe('golden-standard-workflow package', () => {
  function loadDefinition() {
    return WorkflowDefinitionSchema.safeParse({
      ...(readJson('src/golden-standard-workflow.wd.json') as Record<string, unknown>),
      version: 1,
    });
  }

  it('validates against WorkflowDefinitionSchema', () => {
    const result = loadDefinition();

    if (!result.success) {
      console.error(result.error.format());
    }

    expect(result.success).toBe(true);
  });

  it('uses current control-mode schema shapes', () => {
    const result = loadDefinition();
    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.data.steps.some((step) => step.executor === 'cowork')).toBe(true);
    expect(result.data.steps.some((step) => step.executor === 'agent' && step.autonomyLevel === 'L3')).toBe(true);
    expect(result.data.steps.some((step) => step.executor === 'agent' && step.autonomyLevel === 'L4')).toBe(true);
    expect(result.data.steps.some((step) => step.executor === 'agent' && step.autonomyLevel === 'L2')).toBe(false);

    for (const step of result.data.steps) {
      if (step.executor !== 'agent') {
        expect(step.autonomyLevel, `${step.id} should not set autonomyLevel`).toBeUndefined();
      }
    }
  });

  it('does not use deprecated step-level MCP definitions', () => {
    const result = loadDefinition();
    expect(result.success).toBe(true);
    if (!result.success) return;

    for (const step of result.data.steps) {
      expect(step.agent?.mcpServers, `${step.id} agent.mcpServers is deprecated`).toBeUndefined();
      expect(step.cowork?.mcpServers, `${step.id} cowork.mcpServers is deprecated`).toBeUndefined();
      if (step.mcpRestrictions !== undefined) {
        expect(step.agentId, `${step.id} has restrictions and must reference an Agent Definition`).toBeDefined();
      }
    }
  });

  it('declares import manifest path to the workflow definition', () => {
    const manifest = readJson('index.json') as { workflows: Array<{ name: string; path: string }> };
    expect(manifest.workflows).toContainEqual(
      expect.objectContaining({
        name: 'golden-standard-workflow',
        path: 'src/golden-standard-workflow.wd.json',
      }),
    );
  });

  it('validates MCP setup artifacts', () => {
    expect(ToolCatalogEntrySchema.safeParse(readJson('setup/tool-catalog-entry.json')).success).toBe(true);
    expect(AgentDefinitionSchema.safeParse(readJson('setup/agent-definition.json')).success).toBe(true);
  });
});
