import { describe, it, expect } from 'vitest';
import { WorkflowStepSchema } from '../../schemas/workflow-definition';
import { BLOCK_PRESETS, BLOCK_CAPABILITY_KEYS, type BlockPreset } from '../block-presets';

function fillPath(target: Record<string, unknown>, dottedPath: string, value: unknown): void {
  const segments = dottedPath.split('.');
  let cursor: Record<string, unknown> = target;
  for (const segment of segments.slice(0, -1)) {
    if (typeof cursor[segment] !== 'object' || cursor[segment] === null) cursor[segment] = {};
    cursor = cursor[segment] as Record<string, unknown>;
  }
  cursor[segments[segments.length - 1]] = value;
}

function stepFor(preset: BlockPreset): Record<string, unknown> {
  return { id: 'a-step', name: preset.label, ...structuredClone(preset.payload) };
}

describe('BLOCK_PRESETS', () => {
  it('has unique ids', () => {
    const ids = BLOCK_PRESETS.map((preset) => preset.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('only gates on known capability keys', () => {
    for (const preset of BLOCK_PRESETS) {
      if (preset.requires === undefined) continue;
      expect(BLOCK_CAPABILITY_KEYS).toContain(preset.requires);
    }
  });

  it('produces a schema-valid step for every preset that declares no gaps', () => {
    for (const preset of BLOCK_PRESETS) {
      if (preset.needsInput !== undefined && preset.needsInput.length > 0) continue;
      const result = WorkflowStepSchema.safeParse(stepFor(preset));
      expect(result.success, `${preset.id}: ${JSON.stringify(result.error?.issues)}`).toBe(true);
    }
  });

  it('produces a schema-valid step once each declared gap is filled', () => {
    for (const preset of BLOCK_PRESETS) {
      if (preset.needsInput === undefined || preset.needsInput.length === 0) continue;
      const step = stepFor(preset);

      const before = WorkflowStepSchema.safeParse(step);
      expect(before.success, `${preset.id} should be incomplete until its gaps are filled`).toBe(false);

      for (const path of preset.needsInput) fillPath(step, path, 'placeholder');
      const after = WorkflowStepSchema.safeParse(step);
      expect(after.success, `${preset.id}: ${JSON.stringify(after.error?.issues)}`).toBe(true);
    }
  });

  it('gates the email preset on the email capability', () => {
    const sendEmail = BLOCK_PRESETS.find((preset) => preset.id === 'send-email');
    expect(sendEmail?.requires).toBe('email');
  });

  it('routes only through decision-typed presets', () => {
    const routing = BLOCK_PRESETS.filter((preset) => preset.payload.type === 'decision');
    expect(routing.map((preset) => preset.id)).toContain('route-by-condition');
  });

  it('emits no review-typed step, since the designer no longer creates them', () => {
    for (const preset of BLOCK_PRESETS) {
      expect(preset.payload.type).not.toBe('review');
    }
  });
});
