import { describe, it, expect } from 'vitest';
import { BLOCK_PRESETS } from '@mediforce/platform-core';
import { describeBlockPresets } from '../block-presets-prompt';
import { buildWorkflowAssistantSystemPrompt } from '../system-prompt';

describe('describeBlockPresets', () => {
  it('describes every block the picker offers, so the two cannot diverge', () => {
    const described = describeBlockPresets();
    for (const preset of BLOCK_PRESETS) {
      expect(described, `missing block: ${preset.label}`).toContain(preset.label);
      expect(described, `missing purpose for: ${preset.label}`).toContain(preset.purpose);
    }
  });

  it('carries the executor and, where present, the action kind', () => {
    const described = describeBlockPresets();
    for (const preset of BLOCK_PRESETS) {
      expect(described).toContain(`"executor":"${preset.payload.executor}"`);
    }
    expect(described).toContain('"kind":"email"');
    expect(described).toContain('"kind":"http"');
  });

  it('names the fields the author has to supply, rather than inventing them', () => {
    const described = describeBlockPresets();
    const withGaps = BLOCK_PRESETS.filter((preset) => (preset.needsInput ?? []).length > 0);
    expect(withGaps.length).toBeGreaterThan(0);
    for (const preset of withGaps) {
      for (const path of preset.needsInput ?? []) {
        expect(described, `${preset.label} should name ${path}`).toContain(path);
      }
    }
  });
});

describe('the assistant system prompt', () => {
  it('carries the block catalog, so the assistant does not reinvent the shapes', () => {
    const prompt = buildWorkflowAssistantSystemPrompt();
    expect(prompt).toContain('## Pre-made blocks');
    for (const preset of BLOCK_PRESETS) {
      expect(prompt, `prompt omits: ${preset.label}`).toContain(preset.label);
    }
  });

  it('keeps the judgment branch distinct from the data-driven one', () => {
    const prompt = buildWorkflowAssistantSystemPrompt();
    // "Route by condition" carries no `verdicts`; without this the catalog could
    // read as licence to emit a verdict-less decision step for an approval.
    expect(prompt).toMatch(/judgment[\s\S]{0,120}verdicts/i);
  });

  it('tells the assistant to supply a name, which the shapes deliberately omit', () => {
    const prompt = buildWorkflowAssistantSystemPrompt();
    expect(prompt).toMatch(/shapes above omit `name`/);
    for (const preset of BLOCK_PRESETS) {
      expect(preset.payload).not.toHaveProperty('name');
    }
  });
});
