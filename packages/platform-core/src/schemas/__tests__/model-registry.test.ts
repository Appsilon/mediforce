import { describe, expect, it } from 'vitest';
import { DEFAULT_MODEL, pinDefaultModel } from '../model-registry';

function entry(id: string, retiredAt: string | null = null) {
  return { id, retiredAt };
}

describe('pinDefaultModel', () => {
  it('[DATA] picks the newest Claude Sonnet the registry lists, comparing major then minor version', () => {
    const models = [
      entry('anthropic/claude-sonnet-4.6'),
      entry('anthropic/claude-sonnet-5.5'),
      entry('anthropic/claude-sonnet-5'),
      entry('anthropic/claude-opus-5.5'),
      entry('anthropic/claude-sonnet-4'),
    ];

    expect(pinDefaultModel(models)).toBe('anthropic/claude-sonnet-5.5');
  });

  it('[DATA] ignores the alias itself, batch and other variants, and retired models', () => {
    const models = [
      entry(DEFAULT_MODEL),
      entry('anthropic/claude-sonnet-6:batch'),
      entry('anthropic/claude-sonnet-6:thinking'),
      entry('anthropic/claude-sonnet-5.9', '2026-09-01T00:00:00.000Z'),
      entry('anthropic/claude-sonnet-5.5'),
    ];

    expect(pinDefaultModel(models)).toBe('anthropic/claude-sonnet-5.5');
  });

  it('[DATA] falls back to the alias when the registry lists no Claude Sonnet', () => {
    expect(pinDefaultModel([entry('openai/gpt-4o'), entry('deepseek/deepseek-chat')])).toBe(DEFAULT_MODEL);
    expect(pinDefaultModel([])).toBe(DEFAULT_MODEL);
  });
});
